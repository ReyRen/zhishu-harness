/** Public page-bootstrap options shared by the Host and Client halves. */

import z from '@deepseek-ai/schemastery'

/** Onboarding options after schema defaults are applied. */
export interface Config {
  /** Offer the browser API-key step when no native shell owns credential onboarding. */
  credentialOnboarding: boolean
  /** Use the platform's shared model manager instead of profile-local forms. */
  platformModelManagement: boolean
  /** Deadline for a platform parent's fresh model-authentication ticket. */
  platformModelTicketTimeoutMs: number
}

/** Validate Host configuration and its public page-bootstrap payload. */
export const Config: z<Partial<Config>, Config> = z.object({
  credentialOnboarding: z.boolean().default(true),
  platformModelManagement: z.boolean().default(false),
  platformModelTicketTimeoutMs: z.number().step(1).min(1000).max(120000).default(30000),
})

/** Page-global key carrying only the public onboarding options. */
export const ONBOARDING_CONFIG_GLOBAL = '__DSH_MODELS_ONBOARDING__'
