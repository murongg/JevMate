import { z } from 'zod';
import data from '../policy.json';
const label = z.string().min(1).max(50);
const criteria = z
  .record(
    z.string().regex(/^[a-z][a-z0-9_-]*$/),
    z.object({
      description: z.string().min(1).max(1000),
      label: label.nullable(),
    }),
  )
  .refine((v) => Object.keys(v).length >= 2 && Object.keys(v).length <= 50, 'Use 2–50 options.');
export const policy = z
  .object({
    categories: criteria,
    modules: criteria,
    missingInfoLabel: label,
    missingBelow: z.number().min(0).max(1),
  })
  .parse(data);
export type Policy = typeof policy;
export function allowedLabels(p: Policy): string[] {
  return [
    ...new Set(
      [...Object.values(p.categories), ...Object.values(p.modules)]
        .flatMap((v) => (v.label ? [v.label] : []))
        .concat(p.missingInfoLabel),
    ),
  ];
}
