export const plotStages = ["Dirty", "Cleared", "Planted", "Watered", "Grown"] as const;
export type PlotStage = (typeof plotStages)[number];

export const resourceKinds = ["Scrap", "Seed", "Water", "Harvest"] as const;
export type ResourceKind = (typeof resourceKinds)[number];

export const promptKinds = ["Pickup", "Plot", "Water", "Harvest"] as const;
export type PromptKind = (typeof promptKinds)[number];
