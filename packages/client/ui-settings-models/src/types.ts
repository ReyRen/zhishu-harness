/** Models settings plugin configuration shared by the Host and Client faces; types only. */
import type { Volatile } from '@deepseek-ai/cordis'

/** Model settings options available to the browser through its synced Config. */
export interface ModelsConfig {
  /** Offer the browser API-key step automatically when no native shell owns credential onboarding. */
  credentialOnboarding: Volatile<boolean>
  /** Manage and select models through the platform registry. */
  platformModelManagement: Volatile<boolean>
  /** Timeout in milliseconds for the parent platform to return a model authentication ticket. */
  platformModelTicketTimeoutMs: Volatile<number>
}
