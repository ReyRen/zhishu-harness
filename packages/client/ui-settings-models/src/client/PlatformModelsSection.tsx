/** Native shared-model cards and editor, rendered inside the existing Harness settings shell. */
import { useEffect, useId, type ReactNode, type SelectHTMLAttributes } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Input, Modal, IconPlusOutlineRegular, IconChevronDownOutlineRegular,
  IconSearchOutlineRegular, IconRefreshOutlineRegular, IconSparkleRegular, IconDatabaseOutlineRegular,
  IconLayersOutlineRegular, IconEyeOutlineRegular, IconMicrophoneOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { platformModelRecord, platformModelTenantId, platformModelType, platformModelTypes } from './platform-models-api.ts'
import type { PlatformModelDraft } from './platform-models-draft.ts'
import { platformModelExtra, platformModelExtraValues } from './platform-models-draft.ts'
import { canManagePlatformModels, type PlatformModelsStore, type PlatformModelsState } from './platform-models-store.ts'
import type { PlatformModelsKey } from './platform-models-locales.ts'
import css from './PlatformModelsSection.module.css'

const categoryIcons = { KnowledgeQA: IconSparkleRegular, Embedding: IconDatabaseOutlineRegular,
  Rerank: IconLayersOutlineRegular, VLLM: IconEyeOutlineRegular, ASR: IconMicrophoneOutlineRegular }

/** Narrow page operations and snapshot supplied by the browser plugin. */
export interface PlatformModelsInjected {
  controller: PlatformModelsStore
  hooks: { snapshot: PlatformModelsStore['store'] }
  t: (key: PlatformModelsKey) => string
}
/** Native section props bound by the shared settings renderer. */
export type PlatformModelsSectionProps = InjectFace<PlatformModelsInjected>

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={`${css.field} ${wide ? css.wide : ''}`}><span>{label}</span>{children}</label>
}

function SelectControl(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <span className={css.select}><select {...props} /><IconChevronDownOutlineRegular size={12} className={css.chevron} /></span>
}

function ModelEditor({ controller, state, t }: Pick<PlatformModelsInjected, 'controller' | 't'> & { state: PlatformModelsState }) {
  const formId = useId()
  const draft = state.draft
  if (!draft) return null
  const busy = state.busy !== null
  const locked = draft.id !== undefined && draft.type === 'Embedding'
  const provider = state.providers.find(item => item.id === draft.provider)
  const providers = state.providers.filter(item => item.modelTypes.includes(draft.type))
  const extraValues = platformModelExtraValues(draft.extra)
  const patch = (value: Partial<PlatformModelDraft>) => { controller.patchDraft(value) }
  const textField = (key: 'name' | 'displayName' | 'baseUrl' | 'description' | 'dimension' | 'contextWindow' | 'maxOutputTokens' | 'maxConcurrency', label: PlatformModelsKey, disabled = false) => (
    <Field label={t(label)}><Input value={draft[key]} disabled={disabled} onChange={(event) => { patch({ [key]: event.target.value }) }}
      {...(['dimension', 'contextWindow', 'maxOutputTokens', 'maxConcurrency'].includes(key) ? { inputMode: 'numeric' } : {})}
      {...(key === 'name' ? { required: true, 'data-modal-autofocus': true, list: `${formId}-models` } : {})} /></Field>
  )
  return <Modal open title={t(draft.id ? 'editModel' : 'newModel')} closeLabel={t('cancel')}
    onClose={() => { controller.closeEditor() }} className={css.editor ?? ''} contentClassName={css.editorContent ?? ''}
    footer={<div className={css.footerPanel}>
      <div className={css.feedback} aria-live="polite">
        {extraValues === null && <p className={css.error} role="alert">{t('error_invalidDraft')}</p>}
        {state.editorError && <p className={css.error} role="alert">{t(`error_${state.editorError}`)}</p>}
        {state.tested && <p className={state.tested === 'available' ? css.success : css.error}>{t(state.tested === 'available' ? 'available' : 'unavailableTest')}</p>}
      </div>
      <div className={css.footer}>
        <Button variant="outline" disabled={busy || state.uncertain} onClick={() => { controller.test() }}>{t(state.busy === 'test' ? 'testing' : 'test')}</Button>
        <div className={css.actions}><Button variant="ghost" disabled={busy} onClick={() => { controller.closeEditor() }}>{t('cancel')}</Button>
          <Button type="submit" form={formId} disabled={busy || state.uncertain}>{t(state.busy === 'save' ? 'saving' : 'save')}</Button></div>
      </div>
    </div>}>
    <form id={formId} className={css.form} onSubmit={(event) => { event.preventDefault(); controller.save() }}>
      <fieldset className={css.fields} disabled={busy || state.uncertain}>
        <Field label={t('type')}><SelectControl value={draft.type} disabled={!!draft.id} onChange={(event) => {
          const type = platformModelType(event.target.value)
          patch({ type, ...(type === 'ASR' || type === 'Rerank' ? { source: 'remote' } : {}) })
        }}>
          {platformModelTypes.map(type => <option key={type} value={type}>{t(type)}</option>)}
        </SelectControl></Field>
        <Field label={t('source')}><SelectControl value={draft.source} disabled={locked}
          onChange={(event) => { patch({ source: event.target.value === 'local' ? 'local' : 'remote' }) }}>
          <option value="remote">{t('remote')}</option>
          {draft.type !== 'ASR' && draft.type !== 'Rerank' && <option value="local">{t('local')}</option>}
        </SelectControl></Field>
        <Field label={t('provider')} wide><SelectControl value={draft.provider} disabled={locked} onChange={(event) => {
          const next = state.providers.find(item => item.id === event.target.value)
          const defaults = Object.fromEntries((next?.fields || [])
            .filter(field => !field.secret && field.defaultValue).map(field => [field.key, field.defaultValue]))
          patch({ provider: event.target.value, ...(draft.id ? {} : { extra: JSON.stringify(defaults, null, 2) }),
            ...(!draft.baseUrl && next?.defaultUrls[draft.type] ? { baseUrl: next.defaultUrls[draft.type] } : {}) })
        }}><option value="">{t('customProvider')}</option>
          {draft.provider && !providers.some(item => item.id === draft.provider)
            && <option value={draft.provider}>{draft.provider}</option>}
          {providers.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </SelectControl></Field>
        {textField('name', 'name', locked)}{textField('displayName', 'displayName')}
        <datalist id={`${formId}-models`}>{provider?.models.filter(model => model.type === draft.type)
          .map(model => <option key={model.name} value={model.name} />)}</datalist>
        {draft.source === 'remote' && textField('baseUrl', 'baseUrl', locked)}
        {draft.source === 'local' && <p className={`${css.hint} ${css.wide}`}>{t('localHint')}</p>}
        {draft.source === 'remote' && <>
          <Field label={t('apiKey')}><Input type="password" autoComplete="new-password" spellCheck={false} value={draft.apiKey}
            placeholder={t(draft.savedApiKey ? 'savedKey' : 'optionalKey')} disabled={draft.clearApiKey}
            onChange={(event) => { patch({ apiKey: event.target.value }) }} /></Field>
          <Field label={provider?.fields.find(field => field.secret
            && (!field.modelTypes.length || field.modelTypes.includes(draft.type)))?.label || t('appSecret')}>
            <Input type="password" autoComplete="new-password" spellCheck={false} value={draft.appSecret}
              placeholder={t(draft.savedAppSecret ? 'savedKey' : 'optionalKey')} disabled={draft.clearAppSecret}
              onChange={(event) => { patch({ appSecret: event.target.value }) }} /></Field>
          {draft.savedApiKey && <label className={css.check}><input type="checkbox" checked={draft.clearApiKey} onChange={(event) => { patch({ clearApiKey: event.target.checked, apiKey: '' }) }} />{t('clearApiKey')}</label>}
          {draft.savedAppSecret && <label className={css.check}><input type="checkbox" checked={draft.clearAppSecret} onChange={(event) => { patch({ clearAppSecret: event.target.checked, appSecret: '' }) }} />{t('clearAppSecret')}</label>}
        </>}
        {(provider?.fields || []).filter(field => !field.secret
          && (!field.modelTypes.length || field.modelTypes.includes(draft.type))).map((field) => {
          const value = extraValues?.[field.key] || ''
          const change = (next: string) => { patch({ extra: platformModelExtra(draft, field.key, next) }) }
          return <Field key={field.key} label={field.label}>{field.options.length
            ? <SelectControl disabled={extraValues === null} value={value} onChange={(event) => { change(event.target.value) }}><option value="" />{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</SelectControl>
            : <Input disabled={extraValues === null} value={value} required={field.required}
              onChange={(event) => { change(event.target.value) }} />}</Field>
        })}
        {draft.type === 'Embedding' && <>
          {textField('dimension', 'dimension', locked)}
          <label className={css.check}><input type="checkbox" checked={draft.dimensionOverride} disabled={locked} onChange={(event) => { patch({ dimensionOverride: event.target.checked }) }} />{t('dimensionOverride')}</label>
          {locked && <p className={`${css.hint} ${css.wide}`}>{t('dimensionLocked')}</p>}
        </>}
        {(draft.type === 'KnowledgeQA' || draft.type === 'VLLM') && <>
          {textField('contextWindow', 'contextWindow')}{textField('maxOutputTokens', 'maxOutputTokens')}
          <label className={`${css.check} ${css.wide}`}><input type="checkbox" checked={draft.supportsVision} onChange={(event) => { patch({ supportsVision: event.target.checked }) }} />{t('vision')}</label>
        </>}
        {textField('maxConcurrency', 'maxConcurrency')}{textField('description', 'description')}
        <details className={`${css.advanced} ${css.wide}`}><summary>{t('advanced')}</summary><div className={css.fields}>
          <Field label={t('protocol')}><Input value={draft.interfaceType} placeholder={t('protocolAuto')}
            onChange={(event) => { patch({ interfaceType: event.target.value }) }} /></Field>
          {(['headers', 'extra', 'spec'] as const).map(key => <Field key={key} label={t(key)} wide>
            <textarea className={css.json} rows={4} spellCheck={false} value={draft[key]}
              onChange={(event) => { patch({ [key]: event.target.value }) }} />
          </Field>)}
        </div></details>
      </fieldset>
    </form>
  </Modal>
}

/**
 * Render the native model manager with stable, plugin-owned data and drafts.
 * @param props - settings slot operations, snapshot hook and localized copy.
 * @returns the model category cards and optional native editor.
 */
export function PlatformModelsSection({ controller, useSnapshot, t }: PlatformModelsSectionProps) {
  const state = useSnapshot(value => value)
  useEffect(() => { controller.open() }, [controller])
  const query = state.query.trim().toLocaleLowerCase()
  const rows = state.rows.filter(model => (state.filter === 'all' || model.type === state.filter)
    && (!query || [model.name, model.displayName, model.description,
      typeof model.parameters.provider === 'string' ? model.parameters.provider : ''].join(' ').toLocaleLowerCase().includes(query)))
  const writable = canManagePlatformModels(state)
  return <section className={css.section}>
    <div className={css.heading}><div><h2 className={css.title}>{t('title')}</h2><p className={css.intro}>{t('intro')}</p></div>
      <Button size="sm" variant="outline" disabled={!writable || state.busy !== null} onClick={() => { controller.edit(state.filter === 'all' ? 'KnowledgeQA' : state.filter) }}>
        <IconPlusOutlineRegular size={14} />{t('add')}
      </Button>
    </div>
    <div className={css.toolbar}>
      <Field label={t('workspace')}><SelectControl value={state.tenantId || ''} disabled={state.busy !== null || !!state.draft || !!state.deleting} onChange={(event) => { controller.selectSpace(platformModelTenantId(event.target.value)) }}>
        {state.context?.spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}
      </SelectControl></Field>
      <Input className={css.search ?? ''} icon={<IconSearchOutlineRegular size={16} />} aria-label={t('search')} placeholder={t('search')} value={state.query} onChange={(event) => { controller.filter({ query: event.target.value }) }} />
      <Button size="sm" variant="ghost" icon={<IconRefreshOutlineRegular size={16} />} disabled={state.refreshing || state.busy !== null} onClick={() => { controller.refresh() }}>{t('refresh')}</Button>
    </div>
    <div className={css.tabs} role="group" aria-label={t('type')}>
      {(['all', ...platformModelTypes] as const).map((type) => {
        const Icon = type === 'all' ? IconLayersOutlineRegular : categoryIcons[type]
        return <button key={type} type="button" className={css.tab} aria-pressed={state.filter === type} onClick={() => { controller.filter({ filter: type }) }}>
          <Icon size={16} />{t(type)}<span className={css.count}>{type === 'all' ? state.rows.length : state.rows.filter(model => model.type === type).length}</span>
        </button>
      })}
    </div>
    {!writable && state.status === 'ready' && <p className={css.hint}>{t('readOnly')}</p>}
    {state.error && <div className={css.notice} role="alert"><p>{t(`error_${state.error}`)}</p><Button size="sm" variant="outline" onClick={() => { controller.refresh() }}>{t('retry')}</Button></div>}
    <div className={css.grid} aria-busy={state.refreshing} aria-label={t('title')}>
      {state.status === 'loading' && state.rows.length === 0
        ? <div className={css.skeletons} role="status" aria-label={t('loading')}>{[0, 1, 2].map(id => <div key={id} className={css.skeleton} />)}</div>
        : rows.map((model) => {
          const Icon = categoryIcons[model.type]
          const provider = state.providers.find(item => item.id === model.parameters.provider)?.label
            || (typeof model.parameters.provider === 'string' ? model.parameters.provider : t('customProvider'))
          const embedding = model.parameters.embedding_parameters
          const capacity = model.type === 'Embedding' && platformModelRecord(embedding)
            ? embedding.dimension : model.parameters.context_window
          return <article key={model.id} className={css.card}>
            <div className={css.cardHead}>
              <span className={css.modelIcon}><Icon size={20} /></span>
              <div className={css.modelIdentity}>
                <span className={css.badge}>{t(model.type)}</span>
                <h3 className={css.modelName}>{model.displayName || model.name}</h3>
              </div>
              {model.builtin && <span className={css.builtin}>{t('builtin')}</span>}
            </div>
            {model.displayName && <p className={css.identifier}>{model.name}</p>}
            {model.description && <p className={css.description}>{model.description}</p>}
            <dl className={css.metadata}>
              <div><dt>{t('provider')}</dt><dd>{model.source === 'local' ? t('local') : provider}</dd></div>
              {typeof capacity === 'number' && capacity > 0 && <div><dt>{t(model.type === 'Embedding' ? 'dimension' : 'contextWindow')}</dt><dd>{capacity.toLocaleString()}</dd></div>}
            </dl>
            <div className={css.cardFoot}><span className={css.status} data-state={model.status}>{t(model.status === 'downloading' || model.status === 'download_failed' ? model.status : 'active')}</span>
              <div className={css.actions}>
                {canManagePlatformModels(state, model) && <Button size="sm" variant="ghost" disabled={state.busy !== null} onClick={() => { controller.edit(model.type, model) }}>{t('edit')}</Button>}
                {writable && <Button size="sm" variant="ghost" disabled={state.busy !== null} onClick={() => { controller.copy(model, `${model.displayName || model.name} · ${t('copySuffix')}`) }}>{t('copy')}</Button>}
                {canManagePlatformModels(state, model) && <Button size="sm" variant="ghost" disabled={state.busy !== null} onClick={() => { controller.confirmDelete(model) }}>{t('remove')}</Button>}
              </div>
            </div>
          </article>
        })}
    </div>
    {state.status === 'ready' && !rows.length && <p className={css.empty}>{t(query ? 'noResults' : 'empty')}</p>}
    <ModelEditor controller={controller} state={state} t={t} />
    <Modal open={state.deleting !== null} title={t('deleteTitle')} closeLabel={t('cancel')} onClose={() => { controller.confirmDelete(null) }}
      footer={<><Button variant="ghost" disabled={state.busy !== null} onClick={() => { controller.confirmDelete(null) }}>{t('cancel')}</Button>
        <Button disabled={state.busy !== null} onClick={() => { controller.remove() }}>{t('remove')}</Button></>}>
      <p className={css.modelName}>{state.deleting?.displayName || state.deleting?.name}</p><p className={css.hint}>{t('deleteHint')}</p>
      {state.error && <p role="alert" className={css.error}>{t(`error_${state.error}`)}</p>}
    </Modal>
  </section>
}
