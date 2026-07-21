// Shared visual feedback: which refiners are mid-job, and the last refined sale
// colour for the credits rate flash. Kept outside React like the other world stores.

type RefinerJob = { x: number; y: number; progress: number }; // progress 0..1 remaining fraction

let jobs: RefinerJob[] = [];
const jobListeners = new Set<() => void>();

export function setRefinerJobs(next: RefinerJob[]): void {
  jobs = next;
  for (const fn of jobListeners) fn();
}

export function getRefinerJobs(): RefinerJob[] {
  return jobs;
}

export function subscribeRefinerJobs(fn: () => void): () => void {
  jobListeners.add(fn);
  return () => {
    jobListeners.delete(fn);
  };
}

type SaleFlash = { color: string; at: number };

let flash: SaleFlash | null = null;
const flashListeners = new Set<() => void>();

export function flashRefinedSale(color: string): void {
  flash = { color, at: performance.now() };
  for (const fn of flashListeners) fn();
}

export function getSaleFlash(): SaleFlash | null {
  return flash;
}

export function subscribeSaleFlash(fn: () => void): () => void {
  flashListeners.add(fn);
  return () => {
    flashListeners.delete(fn);
  };
}

const COACH_KEY = "cogfab.coach.dismissed";

export function coachDismissed(): boolean {
  try {
    return localStorage.getItem(COACH_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissCoach(): void {
  try {
    localStorage.setItem(COACH_KEY, "1");
  } catch {
    /* ignore quota / private mode */
  }
}
