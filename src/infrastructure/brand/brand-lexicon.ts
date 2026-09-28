export type BrandLexiconEntry = {
  term: string;
  category:
    | "FEATURE"
    | "PROBLEM"
    | "VALUE_PROP"
    | "CALL_TO_ACTION"
    | "AUDIENCE"
    | "COMPETITOR"
    | "INDUSTRY_TERM";
  pattern: RegExp;
  explicit: boolean;
};

export const VOICE_SIGNAL_LEXICON: {
  terms: BrandLexiconEntry[];
  avoid: BrandLexiconEntry[];
} = {
  terms: [
    { term: "automation", category: "FEATURE", pattern: /\bautomat(?:e|ed|ion|ing)\b/i, explicit: false },
    { term: "analytics", category: "FEATURE", pattern: /\banalytics\b/i, explicit: false },
    { term: "dashboard", category: "FEATURE", pattern: /\bdashboards?\b/i, explicit: false },
    { term: "integration", category: "FEATURE", pattern: /\bintegrations?\b/i, explicit: false },
    { term: "collaboration", category: "FEATURE", pattern: /\bcollaborat(?:e|ion|ive|ing)\b/i, explicit: false },
    { term: "content operating system", category: "FEATURE", pattern: /\bcontent operating system\b/i, explicit: true },
    { term: "workflow", category: "FEATURE", pattern: /\bworkflows?\b/i, explicit: false },
    { term: "templating", category: "FEATURE", pattern: /\btemplat(?:e|es|ing)\b/i, explicit: false },
    { term: "versioning", category: "FEATURE", pattern: /\bversion(?:s|ed|ing| control)?\b/i, explicit: false },
    { term: "governance", category: "VALUE_PROP", pattern: /\bgovernance\b/i, explicit: false },
    { term: "reproducibility", category: "VALUE_PROP", pattern: /\breproducib(?:le|ility)\b/i, explicit: false },
    { term: "compliance", category: "VALUE_PROP", pattern: /\bcompliance\b/i, explicit: false },
    { term: "audit trail", category: "VALUE_PROP", pattern: /\baudit (?:trail|log|history)\b/i, explicit: true },
    { term: "single source of truth", category: "VALUE_PROP", pattern: /\bsingle source of truth\b/i, explicit: true },
    { term: "time to value", category: "VALUE_PROP", pattern: /\btime to value\b/i, explicit: true },
    { term: "reduce churn", category: "PROBLEM", pattern: /\breduc(?:e|ing) churn\b/i, explicit: true },
    { term: "developer productivity", category: "AUDIENCE", pattern: /\bdeveloper productivity\b/i, explicit: true },
    { term: "content teams", category: "AUDIENCE", pattern: /\bcontent teams?\b/i, explicit: true },
    { term: "marketing teams", category: "AUDIENCE", pattern: /\bmarketing teams?\b/i, explicit: true },
  ],
  avoid: [
    { term: "synergy", category: "INDUSTRY_TERM", pattern: /\bsynerg(?:y|ies|ize|ise)\b/i, explicit: true },
    { term: "revolutionary", category: "INDUSTRY_TERM", pattern: /\brevolutionar(?:y)?\b/i, explicit: true },
    { term: "game-changing", category: "INDUSTRY_TERM", pattern: /\bgame[- ]chang(?:ing|er)\b/i, explicit: true },
    { term: "web3", category: "INDUSTRY_TERM", pattern: /\bweb3\b/i, explicit: true },
    { term: "blockchain", category: "INDUSTRY_TERM", pattern: /\bblockchain\b/i, explicit: true },
    { term: "guru", category: "INDUSTRY_TERM", pattern: /\bguru\b/i, explicit: true },
    { term: "rockstar", category: "INDUSTRY_TERM", pattern: /\brock ?stars?\b/i, explicit: true },
    { term: "best-in-class", category: "INDUSTRY_TERM", pattern: /\bbest[- ]in[- ]class\b/i, explicit: true },
    { term: "seamless", category: "INDUSTRY_TERM", pattern: /\bseamless(?:ly)?\b/i, explicit: true },
  ],
};

/**
 * A labelled line such as "Voice: plain and direct" is titled by its own label.
 * One shared title for every label would put unrelated statements in the same
 * slot and report them as a disagreement.
 */
export const GUIDELINE_PATTERNS: {
  re: RegExp;
  title: string;
  avoid: boolean;
  titledByLabel?: boolean;
}[] = [
  { re: /^(?:do not|don'?t|never|avoid|no)\s+(.{4,160})$/i, title: "Avoid", avoid: true },
  { re: /^(?:always|use|prefer|write|keep|stick to)\s+(.{4,160})$/i, title: "Guideline", avoid: false },
  {
    re: /^(voice|tone|style|brand|typography|colors?|colours?|logo|positioning|tagline|mission|values?|audience)(?:\s+is|:|-)\s*(.{4,200})$/i,
    title: "Brand",
    avoid: false,
    titledByLabel: true,
  },
];

export const AVOID_LANGUAGE =
  /\b(?:do not|don'?t|never|avoid|refrain from|no longer|stop using|we do not use|forbidden|deprecated)\b/i;

export const CTA_TERMS: { term: string; pattern: RegExp; generic: boolean }[] = [
  { term: "Get started", pattern: /\bget started\b/i, generic: true },
  { term: "Start free trial", pattern: /\bstart (?:a )?free trial\b/i, generic: false },
  { term: "Book a demo", pattern: /\bbook a demo\b/i, generic: false },
  { term: "Request a demo", pattern: /\brequest a demo\b/i, generic: false },
  { term: "Contact sales", pattern: /\bcontact sales\b/i, generic: false },
  { term: "Talk to sales", pattern: /\btalk to (?:sales|us)\b/i, generic: false },
  { term: "Sign up", pattern: /\bsign up\b/i, generic: true },
  { term: "Subscribe", pattern: /\bsubscribe\b/i, generic: true },
  { term: "Download", pattern: /\bdownload\b/i, generic: true },
  { term: "Learn more", pattern: /\blearn more\b/i, generic: true },
  { term: "Read more", pattern: /\bread more\b/i, generic: true },
  { term: "Join waitlist", pattern: /\bjoin (?:the )?waitlist\b/i, generic: false },
];

export const VOICE_TONE_RULES: { kind: string; value: string; test: RegExp }[] = [
  { kind: "TONE", value: "confident", test: /\b(?:confident|assertive|bold|decisive|unapologetic)\b/i },
  { kind: "TONE", value: "authoritative", test: /\b(?:authoritative|commanding|expert|credible)\b/i },
  { kind: "TONE", value: "friendly", test: /\b(?:friendly|warm|welcoming|approachable|caring|human|empathetic)\b/i },
  { kind: "TONE", value: "playful", test: /\b(?:playful|witty|humorous|humourous|quirky|cheeky|clever|fun)\b/i },
  { kind: "TONE", value: "professional", test: /\b(?:professional|formal|polished|corporate|enterprise)\b/i },
  { kind: "TONE", value: "technical", test: /\b(?:technical|engineer|precise|rigorous|developer-focused|api)\b/i },
  { kind: "TONE", value: "minimal", test: /\b(?:minimal|concise|direct|plain|efficient|to the point)\b/i },
  { kind: "TONE", value: "innovative", test: /\b(?:innovative|forward|visionary|cutting edge|modern|future)\b/i },
  { kind: "TONE", value: "calm", test: /\b(?:calm|clear|steady|thoughtful|measured|calmly)\b/i },
  { kind: "TONE", value: "optimistic", test: /\b(?:optimistic|upbeat|inspiring|encouraging)\b/i },
];

export const VOICE_PRONOUN_RULES: { kind: string; value: string; test: RegExp }[] = [
  { kind: "PRONOUN", value: "first-person plural", test: /\b(?:we|our|us|ours)\b/i },
  { kind: "PRONOUN", value: "second person", test: /\b(?:you|your|yours)\b/i },
];

export const VOICE_PERSPECTIVE_RULES: { kind: string; value: string; test: RegExp }[] = [
  { kind: "PERSPECTIVE", value: "problem-first", test: /\b(?:pain|frustrat|struggl|problem|broken|outdated|manual)\b/i },
  { kind: "PERSPECTIVE", value: "outcome-first", test: /\b(?:outcome|result|impact|benefit|achieve|grow|ship faster)\b/i },
  { kind: "PERSPECTIVE", value: "product-first", test: /\b(?:platform|product|api|integrat|workflow)\b/i },
];

export const HEX_IN_TEXT = /#[0-9a-fA-F]{6}\b/g;

export const COLOR_ROLE_KEYWORDS: { role: string; test: RegExp }[] = [
  { role: "PRIMARY", test: /\bprimary (?:brand )?(?:colou?r)\b/i },
  { role: "SECONDARY", test: /\bsecondary (?:brand )?(?:colou?r)\b/i },
  { role: "ACCENT", test: /\baccent (?:brand )?(?:colou?r)\b/i },
  { role: "BACKGROUND", test: /\bback ?ground colou?r\b/i },
  { role: "TEXT", test: /\btext colou?r\b/i },
];

export const FONT_ROLE_KEYWORDS: { role: string; test: RegExp }[] = [
  { role: "HEADING", test: /\b(?:heading|headline|display|title) (?:font|typeface)\b/i },
  { role: "BODY", test: /\b(?:body|paragraph) (?:font|typeface)\b/i },
  { role: "MONOSPACE", test: /\b(?:mono ?space|code) (?:font|typeface)\b/i },
  { role: "DISPLAY", test: /\bdisplay (?:font|typeface)\b/i },
];
