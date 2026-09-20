import raw from "@/config/gameModules.json";

export interface GameModule {
  id: string;
  name: string;
  icon: string;
  tagline: string;
  category: string;
  accent: string;
  minPlayers: number;
  maxPlayers: number;
  isFree: boolean;
  sort: number;
}

/** Catalog 18 game (sinh từ EventPlay bằng scripts/export-manifests.mjs). */
export const GAME_MODULES: GameModule[] = (raw as GameModule[])
  .slice()
  .sort((a, b) => a.sort - b.sort);

export const GAME_MODULE_IDS: string[] = GAME_MODULES.map((m) => m.id);

export function getGameModule(id: string): GameModule | undefined {
  return GAME_MODULES.find((m) => m.id === id);
}

export function freeModuleIds(): string[] {
  return GAME_MODULES.filter((m) => m.isFree).map((m) => m.id);
}

export const CATEGORY_LABELS: Record<string, string> = {
  casual: "Giải trí",
  arcade: "Arcade",
  platformer: "Chạy nhảy",
  ar: "Webcam / AR",
  puzzle: "Giải đố",
  memory: "Trí nhớ",
  quiz: "Đố vui",
  hidden: "Tìm ẩn",
  wheel: "Vòng quay",
};
