export const meta = {
  name: 'medicus-research-swarm',
  description:
    'Sonnet research swarm: market scan + repo review feeding the Medicus Suite next-level planning pipeline',
  whenToUse: 'Stage 1 of the next-level planning swarm. Run first; feed its output to medicus-expert-swarm.',
  phases: [
    {
      title: 'Research',
      detail: '4 parallel Sonnet analysts: market, tech trends, engineering review, product/UX review',
      model: 'sonnet',
    },
  ],
};

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['summary', 'findings', 'opportunities'],
  properties: {
    summary: { type: 'string', description: 'Three-to-five sentence executive summary of what you found' },
    findings: {
      type: 'array',
      minItems: 5,
      items: {
        type: 'string',
        description: 'One concrete, evidenced finding (cite file paths or sources where possible)',
      },
    },
    opportunities: {
      type: 'array',
      minItems: 3,
      items: {
        type: 'object',
        required: ['title', 'rationale'],
        properties: {
          title: { type: 'string' },
          rationale: { type: 'string', description: 'Why this matters for Medicus Suite specifically' },
          impact: {
            type: 'string',
            description: 'Who benefits and how much (clinician time, patient safety, adoption...)',
          },
        },
      },
    },
  },
};

const CONTEXT = `
Context: Medicus Suite is a mature Chrome extension (v3.125.0, ~100 test files) used by a UK GP
practice on top of the Medicus EHR (a Vue + AG-Grid SPA). It provides a side-panel of clinical
modules, a triage-lens content script that injects safety chips into the live task queue, a rules
engine for drug monitoring and result triage, a patient-record visualiser, CQC/practice reporting,
and a full clinical-safety documentation set (DCB0129-style hazard log, safety case) in docs/.
Its author is a GP partner and health-tech consultant; a second practice user (Nick) recently
onboarded. Read docs/VISION.md, docs/feature-list.md, CHANGELOG.md and CLAUDE.md for orientation.
`;

const BRIEFS = [
  {
    key: 'market',
    prompt: `You are a health-tech market analyst. ${CONTEXT}
Research the current market landscape around this product using web search:
- UK primary-care clinical productivity / decision-support tools layered on EHRs (e.g. Ardens, Accurx, Klinik, Patchs, Surgery Intellect, Anima, eConsult, TORTUS and other AI scribes) — what do the leaders offer that Medicus Suite doesn't?
- What are practices actually buying/adopting in 2025–26? What's driving NHS primary-care procurement (capacity crisis, QOF changes, Pharmacy First, ARRS roles)?
- Where is there white space a practice-built extension can own that vendors can't or won't?
Return evidenced findings and concrete product opportunities. Your final output must be the structured data only.`,
  },
  {
    key: 'tech-trends',
    prompt: `You are a staff-level technology scout. ${CONTEXT}
Research (web search) the technology trends most relevant to taking this extension to the next level:
- Browser-extension platform capabilities 2025–26: Chrome side panel APIs, offscreen documents, built-in on-device AI (Gemini Nano / Prompt API), WebGPU local inference, Manifest V3 constraints.
- LLM integration patterns for clinical tools: local vs API, structured extraction, ambient scribing, RAG over guidelines (NICE/CKS/BNF), safety guardrails for clinical AI.
- Interop: FHIR UK Core, GP Connect, NHS App, MESH — what could a practice extension realistically plug into?
Return evidenced findings and concrete technical opportunities. Your final output must be the structured data only.`,
  },
  {
    key: 'engineering',
    prompt: `You are a principal engineer doing a codebase review. ${CONTEXT}
Review THIS repository (cwd) hands-on. Read CLAUDE.md, manifest.json, service-worker.js, the engine/ rules engine, content-scripts/triage-lens/, side-panel/panel.js and a sample of modules, shared/, scripts/, and the test suite layout.
Assess: architecture strengths/weaknesses, tech debt, fragility hot-spots (e.g. the Vue/AG-Grid injection contract), test coverage gaps, build/release process, performance, and where the engineering platform limits what features can be built next.
Return evidenced findings (cite file paths) and concrete engineering opportunities. Your final output must be the structured data only.`,
  },
  {
    key: 'product-ux',
    prompt: `You are a senior product designer + product manager reviewing an existing product. ${CONTEXT}
Review THIS repository (cwd) hands-on from the user's seat. Read docs/VISION.md, docs/feature-list.md, CHANGELOG.md (recent 30 entries), side-panel/panel.html, several side-panel modules' JS/CSS, the options page, the tour (side-panel/tour/), and design-system/.
Assess: information architecture (how many tabs, is it coherent?), workflow fit for a GP's day, onboarding for new users like Nick, visual/interaction consistency, discoverability of powerful features, and gaps between the vision doc and what's shipped.
Return evidenced findings (cite file paths) and concrete product/UX opportunities. Your final output must be the structured data only.`,
  },
];

phase('Research');
log('Spawning 4 Sonnet research analysts: market, tech trends, engineering review, product/UX review');

const results = await parallel(
  BRIEFS.map(
    (b) => () =>
      agent(b.prompt, {
        label: `research:${b.key}`,
        phase: 'Research',
        model: 'sonnet',
        schema: FINDINGS_SCHEMA,
      })
  )
);

const out = {};
BRIEFS.forEach((b, i) => {
  out[b.key] = results[i];
});
const missing = BRIEFS.filter((b, i) => !results[i]).map((b) => b.key);
if (missing.length) log(`WARNING: research lanes returned nothing: ${missing.join(', ')}`);

return out;
