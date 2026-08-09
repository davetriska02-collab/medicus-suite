export const meta = {
  name: 'medicus-expert-swarm',
  description:
    'Opus expert swarm: six top developer/designer personas propose next-level developments for Medicus Suite, then a challenge panel stress-tests them',
  whenToUse:
    'Stage 2 of the next-level planning swarm. Pass the medicus-research-swarm digest as args. The orchestrator (Fable) synthesises the output into a top-10 plan.',
  phases: [
    { title: 'Propose', detail: '6 parallel Opus experts each propose 4-6 developments', model: 'opus' },
    { title: 'Challenge', detail: 'red-team panel stress-tests the combined proposal list', model: 'opus' },
  ],
};

const research = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
if (!research || research === 'undefined') {
  throw new Error('medicus-expert-swarm requires the research digest passed as args');
}

const PROPOSALS_SCHEMA = {
  type: 'object',
  required: ['proposals'],
  properties: {
    proposals: {
      type: 'array',
      minItems: 4,
      maxItems: 6,
      items: {
        type: 'object',
        required: ['title', 'description', 'why_now', 'impact', 'effort', 'risk'],
        properties: {
          title: { type: 'string', description: 'Short, concrete feature/initiative name' },
          description: { type: 'string', description: '2-4 sentences: what gets built and how it works' },
          why_now: { type: 'string', description: 'Why this is the next best move given the research digest' },
          impact: { type: 'string', enum: ['transformative', 'high', 'medium'] },
          effort: { type: 'string', enum: ['small', 'medium', 'large'] },
          risk: { type: 'string', description: 'Main clinical-safety / technical / adoption risk and mitigation' },
        },
      },
    },
  },
};

const CHALLENGE_SCHEMA = {
  type: 'object',
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'verdict', 'reason'],
        properties: {
          title: { type: 'string', description: 'Proposal title being judged (verbatim from the list)' },
          verdict: { type: 'string', enum: ['strong', 'keep', 'weak', 'kill'] },
          reason: { type: 'string' },
        },
      },
    },
  },
};

const SHARED = `
You are advising on Medicus Suite — a mature, tested Chrome extension a UK GP practice runs on top
of the Medicus EHR (side-panel clinical modules, injected safety chips in the live task queue,
drug-monitoring and result-triage rules engines, patient visualiser, CQC reporting, full clinical
safety documentation). It is practice-built, patient-safety-critical, and now has its second user.
You may read the repository (cwd) to ground your proposals in what exists.

Research digest from the Sonnet analyst swarm (market, tech trends, engineering review, product/UX review):

${research}

Propose the 4-6 next developments YOU would champion. Be specific to this codebase and this user —
a proposal that names existing modules/files beats a generic one. No vapourware: each proposal must
be buildable in this repo. Your final output must be the structured data only.`;

const EXPERTS = [
  {
    key: 'platform-architect',
    persona:
      'You are a staff browser-extension platform architect (ex-Chrome team). You care about architecture leverage: what platform investment unlocks the most future features, resilience of the EHR injection layer, MV3 service-worker discipline, storage/sync, and update/release engineering.',
  },
  {
    key: 'clinical-ux-designer',
    persona:
      "You are a principal product designer specialised in clinical software (think Epic/Ardens-calibre, but taste of Linear/Stripe). You care about a GP's cognitive load in a 10-minute consultation, information architecture across the tab set, glanceability of safety signals, onboarding for new staff, and design-system coherence.",
  },
  {
    key: 'ai-engineer',
    persona:
      'You are a top applied-AI engineer for clinical products. You care about where an LLM (local on-device or API) genuinely earns its place: structured extraction, summarisation of the record, guideline RAG, triage assistance — always with deterministic fallbacks and clinician-in-the-loop, never autonomous clinical decisions.',
  },
  {
    key: 'clinical-safety-engineer',
    persona:
      'You are a clinical safety engineer (DCB0129/0160 fluent) who is also a strong developer. You care about hazard-driven prioritisation: which developments most reduce real patient risk, which existing features carry latent hazards worth engineering away, assurance/test infrastructure, and audit trails.',
  },
  {
    key: 'data-engineer',
    persona:
      "You are a senior data/analytics engineer for primary care. You care about turning the extension's vantage point into population-level intelligence: demand/capacity analytics, QOF/recall gap-finding, longitudinal trends, practice-level dashboards — computed locally, privacy-first, nothing leaving the machine.",
  },
  {
    key: 'product-strategist',
    persona:
      'You are a pragmatic product strategist for clinician-built tools. You care about the path from "one practice\'s extension" to durable product: multi-user/multi-practice readiness, configuration sharing, community rule libraries, distribution, and what to deliberately NOT build.',
  },
];

phase('Propose');
log(
  'Spawning 6 Opus experts: platform architect, clinical UX designer, AI engineer, clinical safety engineer, data engineer, product strategist'
);

const expertResults = await parallel(
  EXPERTS.map(
    (e) => () =>
      agent(`${e.persona}\n${SHARED}`, {
        label: `expert:${e.key}`,
        phase: 'Propose',
        model: 'opus',
        schema: PROPOSALS_SCHEMA,
      })
  )
);

const allProposals = [];
EXPERTS.forEach((e, i) => {
  const r = expertResults[i];
  if (!r) {
    log(`WARNING: expert ${e.key} returned nothing`);
    return;
  }
  r.proposals.forEach((p) => allProposals.push({ expert: e.key, ...p }));
});
log(`${allProposals.length} proposals collected; running challenge panel`);

// Barrier is deliberate: the challenge panel needs the FULL cross-expert list to judge
// overlap, opportunity cost, and relative strength.
phase('Challenge');
const proposalList = allProposals
  .map((p, i) => `${i + 1}. [${p.expert}] ${p.title} — ${p.description} (impact: ${p.impact}, effort: ${p.effort})`)
  .join('\n');

const CHALLENGERS = [
  {
    key: 'skeptic',
    prompt: `You are a ruthless skeptic reviewing a proposed roadmap for Medicus Suite (a patient-safety-critical GP Chrome extension; read the repo in cwd if needed). For EVERY numbered proposal below, judge it: "strong" (clearly among the best next moves), "keep" (good), "weak" (sounds nice, low real value or duplicative), "kill" (vapourware, unsafe, or wrong for a 2-user practice tool). Judge the proposal, not the prose. Punish duplication across experts, scope creep, and anything that adds maintenance burden without clinical value.\n\n${proposalList}\n\nYour final output must be the structured data only.`,
  },
  {
    key: 'working-gp',
    prompt: `You are a time-poor UK GP partner who uses Medicus Suite all day (read the repo in cwd if needed). For EVERY numbered proposal below, judge it from the consulting-room seat: "strong" (I'd feel this every session), "keep" (useful), "weak" (wouldn't notice), "kill" (gets in my way or I'd never trust it). Favour things that save minutes per patient or catch errors; distrust anything that adds clicks, alerts fatigue, or requires babysitting.\n\n${proposalList}\n\nYour final output must be the structured data only.`,
  },
];

const challengeResults = await parallel(
  CHALLENGERS.map(
    (c) => () =>
      agent(c.prompt, {
        label: `challenge:${c.key}`,
        phase: 'Challenge',
        model: 'opus',
        schema: CHALLENGE_SCHEMA,
      })
  )
);

return {
  proposals: allProposals,
  challenges: CHALLENGERS.map((c, i) => ({
    panel: c.key,
    verdicts: challengeResults[i] ? challengeResults[i].verdicts : [],
  })),
};
