import type { GeneratorFn } from "../types";
import { randInt } from "../random";

export const generators: Record<string, GeneratorFn> = {};

export function register(type: string, fn: GeneratorFn) {
  generators[type] = fn;
}

export function coeff(rng: () => number, variant: number, spread = 9) {
  const base = (variant % 7) + 1;
  return randInt(rng, 1, spread) * (rng() > 0.5 ? 1 : -1) + base;
}


