import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { getBaseUrl } from '@main/ai/utils/provider'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { type Provider } from '@shared/data/types/provider'

const logger = loggerService.withContext('NovelLlmBridge')

/** Settings storage for the InkOS secrets file (project `.inkos/` dir). */
const SECRETS_PATH = path.join('.inkos', 'secrets.json')

/**
 * Cherry LLM → InkOS engine bridge.
 *
 * The engine's Studio runtime reads its LLM config from the project's
 * `inkos.json` (`llm.services`) plus a secrets file it owns — it deliberately
 * ignores INKOS_LLM_* process env in Studio mode. To let the novel panel use
 * the same model the user already configured in Cherry settings, we materialize
 * that provider (baseUrl + apiKey + model) into the workspace's inkos.json on
 * open — but only when the user has NOT already configured an engine LLM there,
 * so a hand-tuned engine setup always wins.
 *
 * Security note: the API key is written to the workspace's secrets file, which
 * is only readable by the engine process (AGPL) and the user. It is never
 * logged, copied, or returned to the renderer.
 */
export async function syncLlmConfigFromCherry(root: string): Promise<void> {
  try {
    const inkosJson = JSON.parse(await readFile(path.join(root, 'inkos.json'), 'utf-8')) as Record<string, unknown>

    // Already-configured engine LLM wins (user-tuned setup in the Studio UI).
    const llm = (inkosJson.llm as Record<string, unknown> | undefined) ?? {}
    if (Array.isArray(llm.services) && llm.services.length > 0) {
      logger.info('inkos.json already has LLM services; keeping the engine config')
      return
    }

    const bridged = await resolveCherryDefaultLlm()
    if (!bridged) {
      logger.info('no Cherry default model to bridge; engine keeps its own config')
      return
    }

    // Engine service entry: `custom:` + baseUrl + apiKey in its secrets file.
    const serviceKey = `custom:${bridged.providerId}`
    const services = [{ service: 'custom', name: bridged.providerId, baseUrl: bridged.baseUrl }]

    // Merge (preserving any existing services) — the guard above means this is
    // the first LLM config, so the merge is a no-op in practice; it still keeps
    // a future concurrent writer from clobbering entries.
    inkosJson.llm = {
      ...llm,
      configSource: 'studio',
      service: serviceKey,
      defaultModel: bridged.model,
      services: [...(Array.isArray(llm.services) ? llm.services : []), ...services]
    }
    await writeFile(path.join(root, 'inkos.json'), JSON.stringify(inkosJson, null, 2), 'utf-8')

    const secrets = await loadSecrets(root)
    secrets.services = { ...secrets.services, [serviceKey]: { apiKey: bridged.apiKey } }
    const secretsPath = path.join(root, SECRETS_PATH)
    await mkdir(path.dirname(secretsPath), { recursive: true })
    await writeFile(secretsPath, JSON.stringify(secrets, null, 2), 'utf-8')

    logger.info(`Bridged Cherry LLM into workspace (provider ${bridged.providerId}, model ${bridged.model})`)
  } catch (error) {
    // Never block opening a workspace on LLM bridging.
    logger.warn(`failed to bridge Cherry LLM config: ${(error as Error).message}`)
  }
}

/** Resolve the user's default Cherry chat model into an engine-ready triple. */
async function resolveCherryDefaultLlm(): Promise<{
  providerId: string
  baseUrl: string
  apiKey: string
  model: string
} | null> {
  const defaultModelId = application.get('PreferenceService').get('chat.default_model_id') as UniqueModelId | null
  if (!defaultModelId) return null

  const { providerId, modelId } = parseUniqueModelId(defaultModelId)
  let provider: Provider
  try {
    provider = providerService.getByProviderId(providerId)
  } catch {
    return null
  }
  if (!provider.isEnabled) return null

  const baseUrl = getBaseUrl(provider)
  if (!baseUrl) return null

  const apiKey = providerService.getRotatedApiKey(providerId)
  if (!apiKey) return null

  const model = modelService.getByKey(providerId, modelId)
  return { providerId, baseUrl, apiKey, model: model.apiModelId ?? modelId }
}

interface SecretsFile {
  services: Record<string, { apiKey?: string }>
}

/** Read the engine's secrets file, tolerating absence. */
async function loadSecrets(root: string): Promise<SecretsFile> {
  try {
    return JSON.parse(await readFile(path.join(root, SECRETS_PATH), 'utf-8')) as SecretsFile
  } catch {
    return { services: {} }
  }
}
