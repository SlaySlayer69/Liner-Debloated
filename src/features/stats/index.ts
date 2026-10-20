export { default as StatisticsSection } from "./ui/StatisticsSection";
export { useListeningStats, type ListeningStats } from "./hooks/useListeningStats";
export { recordListen, ensureHistoryBackfill } from "./recorder";
export { statsDb } from "./store/statsDb";
export type { PlayRecord, StatsSummary, TopTrack, TopArtist, TopGenre } from "./lib/aggregate";
export type { StatsPeriod } from "./lib/periods";
