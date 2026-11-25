import { z } from 'zod';
export const driveRegistrationSchema = z.object({
  clientId: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/),
  clientValue: z.string().trim().max(512),
});
export const dropboxRegistrationSchema = z.object({
  clientId: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_-]{4,100}$/),
  clientValue: z.literal('').default(''),
});
