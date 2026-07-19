import { z } from 'zod'

const envSchema = z.object({
  UIGRAPH_MCP_SERVER_URL: z.url().min(1),
  UIGRAPH_ACCESS_TOKEN: z.string().optional(),
  UIGRAPH_ORG_ID: z.string().optional(),
})

type Env = z.infer<typeof envSchema>

let cachedEnv: Env | undefined

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv
  const result = envSchema.safeParse(process.env)
  if (result.success) {
    cachedEnv = result.data
    return cachedEnv
  }
  console.error('Invalid environment variables:')
  for (const issue of result.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}
