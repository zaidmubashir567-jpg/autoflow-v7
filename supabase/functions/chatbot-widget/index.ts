// ============================================================
// LeadFyn — chatbot-widget edge function
// Powers the AI Receptionist embedded on client websites
// ============================================================

import { getAdminClient, callAIQuality, ok, err, CORS } from '../_shared/helpers.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  let body; try { body = await req.json(); } catch { return err('Invalid JSON', 400); }
  const { widget_id, message, history = [], visitor_name, visitor_phone } = body;
  if (!widget_id || !message) return err('widget_id and message required', 400);
  const sb = getAdminClient();
  const { data: widget, error: wErr } = await sb.from('chatbot_widgets').select('*, clients(claude_key, name)').eq('id', widget_id).eq('active', true).single();
  if (wErr || !widget) return err('Widget not found or inactive', 404);
  const client = widget.clients;
  const claudeKey = (client?.claude_key ?? widget.claude_key_override);
  if (!claudeKey) return ok({ reply: `Thanks for reaching out to ${widget.business_name}! We'll get back to you shortly.`, captured: false });
  const systemPrompt = buildSystemPrompt(widget);
  const conversationHistory = history.slice(-10).map(h => `${h.role === 'user' ? 'Visitor' : 'You'}: ${h.content}`).join('\n');
  const userPrompt = `${conversationHistory ? `Conversation so far:\n${conversationHistory}\n\n` : ''}Visitor: ${message}\n${visitor_name ? `Note: Visitor name is ${visitor_name}.` : ''}\n${visitor_phone ? `Note: Visitor phone: ${visitor_phone}.` : ''}\nRespond as the AI receptionist. Be helpful and conversational.`;
  let reply; try { reply = await callAIQuality(userPrompt, systemPrompt, { claude_key: claudeKey }); } catch (e) { reply = `Thanks for your message! Someone from ${widget.business_name} will be in touch shortly.`; }
  const capturedName = !visitor_name && extractName(message, reply);
  const capturedPhone = !visitor_phone && extractPhone(message);
  const fullName = visitor_name ?? capturedName ?? null;
  const fullPhone = visitor_phone ?? capturedPhone ?? null;
  if (fullName && fullPhone) await alertClient(sb, widget, fullName, fullPhone, message, client);
  await sb.from('chatbot_logs').insert({ widget_id, client_id: widget.client_id, visitor_message: message, ai_reply: reply, visitor_name: fullName, visitor_phone: fullPhone, captured: !!(fullName && fullPhone), created_at: new Date().toISOString() }).catch(() => {});
  return ok({ reply, captured: !!(fullName && fullPhone), captured_name: capturedName || null, captured_phone: capturedPhone || null });
});

function buildSystemPrompt(widget) {
  const services = widget.servicees?.join(', ') ?? 'our services';
  const hours = widget.business_hours ?? 'during business hours';
  const city = widget.city ?? '';
  const niche = widget.niche ?? 'business';
  return `You are the AI receptionist for ${widget.business_name}, a ${niche}${city ? ` in ${city}` : ''}.\nYour job:\n1. Greet visitors warmly\n2. Help them book an appointment\n3. Capture name and phone\n4. Sound like a human receptionist\nServices: ${services}\nHours: ${hours}\n${widget.faq ? `FAQ:\n${widget.faq}` : ''}\nRules:\n- Keep replies short (2–4 sentences)\n- If pricing asked, say someone will call with quote\n- Once you have name AND phone, confirm you'll pass it along`;
}

function extractName(message, reply) {
  const words = message.trim().split(/\s+/);
  if (words.length >= 1 && words.length <= 3 && /^[A-Z][a-z]+/.test(words[0])) return message.trim();
  const nameMatch = reply.match(/(?:Hi|Hello|Thanks|Thank you),?\s+([A-Z][a-z]+)/);
  return nameMatch?.[1] ?? null;
}

function extractPhone(message) {
  const digits = message.replace(/\D/g, '');
  if (digits.length >= 10) return message.match(/[\d\s\-\(\)\+]{10,}機[0]?.trim() ?? null;
  return null;
}

async function alertClient(sb, widget, name, phone, lastMessage, client) {
  const alertEmail = widget.alert_email;
  if (!alertEmail) return;
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  await fetch(`${supabaseUrl}/functions/v1/submit-contact-form`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` }, body: JSON.stringify({ client_id: widget.client_id, name, phone, source: 'ai_chatbot', business: widget.business_name, alert_email: alertEmail, message: lastMessage, widget_id: widget.id }) }).catch(() => {});
}
