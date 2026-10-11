// Single source of truth for the scroll-driven construction schedule.
// p = 0 is an untouched plot at sunrise, p = 1 is the finished building at blue hour.

export const STAGES = [
  { id: 'survey',     from: 0.00, to: 0.12 },
  { id: 'excavation', from: 0.12, to: 0.28 },
  { id: 'foundation', from: 0.28, to: 0.40 },
  { id: 'structure',  from: 0.40, to: 0.62 },
  { id: 'envelope',   from: 0.62, to: 0.78 },
  { id: 'finishing',  from: 0.78, to: 0.90 },
  { id: 'handover',   from: 0.90, to: 1.00 },
];

// Fine-grained milestones used by the scene modules.
export const T = {
  stakes:     [0.025, 0.07],
  fence:      [0.05, 0.11],
  cabins:     [0.07, 0.11],
  strip:      [0.09, 0.14],   // topsoil stripped
  dig:        [0.13, 0.27],
  rebar:      [0.28, 0.31],
  raft:       [0.305, 0.34],
  basement:   [0.335, 0.38],
  backfill:   [0.37, 0.40],
  craneUp:    [0.29, 0.35],
  structure:  [0.40, 0.64],
  envelope:   [0.56, 0.79],
  craneDown:  [0.77, 0.845],
  craneGone:  [0.845, 0.86],
  fenceDown:  [0.85, 0.885],
  landscape:  [0.80, 0.90],
  lights:     [0.88, 0.97],
};

export function stageIndex(p) {
  for (let i = STAGES.length - 1; i >= 0; i--) if (p >= STAGES[i].from) return i;
  return 0;
}
