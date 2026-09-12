import { z } from 'zod'

/** Bounded data, never model-generated JavaScript. Paths address seat-visible state. */
export const executableStrategySchema = z
  .object({
    actionWeights: z
      .record(
        z.string().min(1).max(200),
        z.number().finite().min(-100).max(100),
      )
      .refine((v) => Object.keys(v).length <= 80),
    avoidActions: z.array(z.string().min(1).max(200)).max(80),
    rules: z
      .array(
        z
          .object({
            when: z
              .array(
                z
                  .object({
                    path: z
                      .string()
                      .min(1)
                      .max(200)
                      .refine(
                        (p) =>
                          !p
                            .split('.')
                            .some((s) =>
                              [
                                '__proto__',
                                'prototype',
                                'constructor',
                              ].includes(s),
                            ),
                      ),
                    op: z.enum([
                      'eq',
                      'ne',
                      'lt',
                      'lte',
                      'gt',
                      'gte',
                      'exists',
                    ]),
                    value: z.union([
                      z.string().max(200),
                      z.number().finite(),
                      z.boolean(),
                      z.null(),
                    ]),
                  })
                  .strict(),
              )
              .min(1)
              .max(8),
            actionId: z.string().min(1).max(200),
            weight: z.number().finite().min(-100).max(100),
          })
          .strict(),
      )
      .max(32),
  })
  .strict()
export type ExecutableStrategy = z.infer<typeof executableStrategySchema>
export const coachedStrategySchema = z
  .object({
    strategy: z.string().trim().min(1).max(2000),
    reason: z.string().trim().min(1).max(1000),
    executableStrategy: executableStrategySchema,
  })
  .strict()
