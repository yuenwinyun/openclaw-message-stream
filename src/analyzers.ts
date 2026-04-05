import type {
  MessageStreamAnalysisConfig,
  MessageStreamFinding,
  MessageStreamMessageAnalysis,
  NormalizedSessionMessage,
} from "./types.js";

const NEGATIVE_SENTIMENT_WORDS = [
  "abuse",
  "angry",
  "attack",
  "broken",
  "cancel",
  "critical",
  "crash",
  "die",
  "fail",
  "fraud",
  "glitch",
  "illegal",
  "outage",
  "panic",
  "problem",
  "rage",
  "risk",
  "scam",
  "stolen",
];

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function compileRegex(pattern: string, flags = "i"): RegExp | null {
  if (!pattern || !pattern.trim()) {
    return null;
  }
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

function pushFinding(
  findings: MessageStreamFinding[],
  rule: string,
  label: string,
  count: number,
  confidence: number,
  details: Record<string, unknown>,
) {
  findings.push({
    rule,
    label,
    count,
    confidence: clamp(confidence),
    details,
  });
}

function analyzeKeywords(message: NormalizedSessionMessage, cfg: MessageStreamAnalysisConfig, findings: MessageStreamFinding[]) {
  if (!cfg.keyword?.enabled) {
    return 0;
  }
  const terms = cfg.keyword.terms ?? [];
  if (terms.length === 0) {
    return 0;
  }
  const lower = message.content.toLowerCase();
  const weight = typeof cfg.keyword.weight === "number" ? cfg.keyword.weight : 1;
  let hits = 0;
  for (const rawTerm of terms) {
    const term = rawTerm.trim().toLowerCase();
    if (!term) {
      continue;
    }
    if (!lower.includes(term)) {
      continue;
    }
    let count = 0;
    let index = lower.indexOf(term);
    while (index >= 0) {
      count += 1;
      index = lower.indexOf(term, index + term.length);
    }
    hits += count;
    pushFinding(
      findings,
      "keyword",
      term,
      count,
      clamp((Math.min(count, 5) / 5) * 0.4 * weight / 10 + 0.2),
      { term, contentLength: message.content.length },
    );
  }
  return clamp(hits / Math.max(1, terms.length));
}

function analyzeRegex(message: NormalizedSessionMessage, cfg: MessageStreamAnalysisConfig, findings: MessageStreamFinding[]) {
  if (!cfg.regex?.enabled) {
    return 0;
  }
  const patterns = cfg.regex.patterns ?? [];
  if (patterns.length === 0) {
    return 0;
  }
  const flags = cfg.regex.caseSensitive ? "g" : "gi";
  const weight = typeof cfg.regex.weight === "number" ? cfg.regex.weight : 1;
  let hits = 0;
  for (const rawPattern of patterns) {
    const regex = compileRegex(rawPattern, flags);
    if (!regex) {
      continue;
    }
    const matches = [...message.content.matchAll(regex)];
    if (matches.length === 0) {
      continue;
    }
    hits += matches.length;
    pushFinding(
      findings,
      "regex",
      `pattern:${rawPattern}`,
      matches.length,
      clamp(0.25 + Math.min(matches.length, 3) * 0.15 * (weight / 10)),
      {
        pattern: rawPattern,
        firstMatch: matches[0]?.[0] ?? "",
      },
    );
  }
  return clamp(hits / Math.max(1, patterns.length));
}

function analyzePii(message: NormalizedSessionMessage, cfg: MessageStreamAnalysisConfig, findings: MessageStreamFinding[]) {
  if (!cfg.pii?.enabled) {
    return 0;
  }
  const weights = typeof cfg.pii.weight === "number" ? cfg.pii.weight : 1;
  let score = 0;
  const email = cfg.pii.detectEmail !== false ? /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi : null;
  const phone = cfg.pii.detectPhone !== false
    ? /\+?\d[\d\s().-]{7,}\d/g
    : null;
  const apiKey =
    cfg.pii.detectApiKey !== false
      ? /\b(sk-|pk_|api[_-]?key|bearer)[\s:=]*[a-zA-Z0-9_-]{20,}\b/gi
      : null;

  if (email) {
    const emailMatches = message.content.match(email);
    if (emailMatches?.length) {
      score += 0.45 * (weights / 10);
      pushFinding(findings, "pii", "email", emailMatches.length, 0.9, {
        matches: Math.min(3, emailMatches.length),
      });
    }
  }
  if (phone) {
    const phoneMatches = message.content.match(phone);
    if (phoneMatches?.length) {
      score += 0.35 * (weights / 10);
      pushFinding(findings, "pii", "phone", phoneMatches.length, 0.72, {
        matches: Math.min(3, phoneMatches.length),
      });
    }
  }
  if (apiKey) {
    const keyMatches = message.content.match(apiKey);
    if (keyMatches?.length) {
      score += 0.2 * (weights / 10);
      pushFinding(findings, "pii", "apiKey", keyMatches.length, 0.96, {
        matches: Math.min(2, keyMatches.length),
      });
    }
  }
  return clamp(score);
}

function analyzeSentiment(message: NormalizedSessionMessage, cfg: MessageStreamAnalysisConfig, findings: MessageStreamFinding[]) {
  if (!cfg.sentiment?.enabled) {
    return 0;
  }
  const negativeTerms = NEGATIVE_SENTIMENT_WORDS;
  const lower = message.content.toLowerCase();
  let hits = 0;
  for (const word of negativeTerms) {
    if (lower.includes(word)) {
      hits += 1;
    }
  }
  if (!hits) {
    return 0;
  }
  const confidence = clamp((Math.min(hits, 10) / 10) * ((cfg.sentiment?.weight ?? 1) / 10));
  pushFinding(findings, "sentiment", "negative", hits, confidence, {
    hits,
    sample: lower.slice(0, 140),
  });
  return clamp(confidence);
}

export function analyzeMessage(
  message: NormalizedSessionMessage,
  config: MessageStreamAnalysisConfig,
): MessageStreamMessageAnalysis {
  const findings: MessageStreamFinding[] = [];
  if (!message.content.trim()) {
    return { score: 0, findings: [], hasFinding: false };
  }

  const keywordScore = analyzeKeywords(message, config, findings);
  const regexScore = analyzeRegex(message, config, findings);
  const piiScore = analyzePii(message, config, findings);
  const sentimentScore = analyzeSentiment(message, config, findings);
  const scoreRaw = Math.max(
    keywordScore * 0.45,
    regexScore * 0.3,
    piiScore * 0.2,
    sentimentScore * 0.05,
  );
  const score = clamp(scoreRaw + (findings.length > 1 ? 0.02 * findings.length : 0));
  return {
    score,
    findings,
    hasFinding: findings.length > 0,
  };
}
