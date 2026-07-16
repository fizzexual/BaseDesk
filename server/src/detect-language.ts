// Lightweight, dependency-free language hint for routing. Returns a language name
// only when there's a clear non-English signal; otherwise null (treat as English/
// unknown and route to anyone). Deliberately conservative — it's a soft preference,
// never a hard filter, so a wrong guess can't strand a ticket.

const SIGNALS: Record<string, string[]> = {
  Spanish: ['hola', 'gracias', 'por favor', 'necesito', 'ayuda', 'cuenta', 'pago', 'no puedo', 'problema', 'pero', 'porque', 'tengo', 'quiero', 'está'],
  French: ['bonjour', 'merci', 'aide', 'compte', 'paiement', 'je ne peux', 'probleme', 'problème', 'mais', 'parce que', 'avec', 'pour', 'vous', 'nous'],
  German: ['hallo', 'danke', 'bitte', 'hilfe', 'konto', 'zahlung', 'kann nicht', 'problem', 'aber', 'weil', 'für', 'ich', 'nicht', 'und'],
  Portuguese: ['olá', 'obrigado', 'obrigada', 'ajuda', 'conta', 'pagamento', 'não posso', 'problema', 'mas', 'porque', 'para', 'estou', 'você', 'preciso'],
  Italian: ['ciao', 'grazie', 'aiuto', 'pagamento', 'non posso', 'problema', 'perché', 'perche', 'sono', 'ho bisogno', 'vorrei', 'questo', 'con'],
};

/** A language name (e.g. "Spanish") when the text clearly reads as one, else null. */
export function detectLanguage(text: string): string | null {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\s']/gu, ' ').replace(/\s+/g, ' ')} `;
  let best: string | null = null;
  let bestScore = 0;
  for (const [lang, words] of Object.entries(SIGNALS)) {
    let score = 0;
    for (const w of words) if (t.includes(` ${w} `)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = lang;
    }
  }
  return bestScore >= 2 ? best : null;
}
