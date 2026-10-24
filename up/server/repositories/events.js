import { randomUUID } from 'node:crypto'
import { atualizarCampos } from './sql.js'

const COLUNAS = `id, title, to_char(date, 'YYYY-MM-DD') as data, all_day, start_time, end_time, category, notes,
  rec_type, rec_weekdays, to_char(rec_until, 'YYYY-MM-DD') as rec_until, exceptions,
  google_event_id, google_etag, to_char(google_updated at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as google_updated,
  sync_state, sync_error, unsupported_recurrence, deleted_at is not null as excluido,
  to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at`

const SELECT = `select ${COLUNAS} from events`

// Formato exposto à interface (mesmo modelo usado pela agenda existente).
export const paraApi = (r) => ({
  id: r.id,
  titulo: r.title,
  data: r.data,
  diaInteiro: r.all_day,
  inicio: r.all_day ? '' : (r.start_time ?? ''),
  fim: r.all_day ? '' : (r.end_time ?? ''),
  categoria: r.category,
  notas: r.notes,
  rec: { tipo: r.rec_type, dias: (r.rec_weekdays ?? []).map(Number), ate: r.rec_until ?? '' },
  excecoes: r.exceptions ?? [],
  sincronizacao: {
    estado: r.sync_state,
    erro: r.sync_error ?? null,
    somenteLeitura: Boolean(r.unsupported_recurrence)
  }
})

export function criarRepoEventos(db) {
  return {
    async listar(userId, limite = 3000) {
      const l = await db.query(`${SELECT} where user_id = $1 and deleted_at is null order by date, start_time, id limit $2`, [userId, limite])
      return l.map(paraApi)
    },
    // Linha bruta (inclui metadados de sincronização). Só da própria conta.
    async bruto(userId, id) {
      const [r] = await db.query(`${SELECT} where user_id = $1 and id = $2`, [userId, id])
      return r ?? null
    },
    async obter(userId, id) {
      const r = await this.bruto(userId, id)
      return r && !r.excluido ? paraApi(r) : null
    },
    // O id do Google é determinístico (uuid sem hífens) e gravado já na criação. Assim, se o envio falhar
    // depois de o Google ter aceitado o evento, a sincronização o reconhece em vez de importá-lo como duplicata.
    async criar(userId, e, estadoSync) {
      const id = randomUUID()
      await db.query(
        `insert into events (id, user_id, title, date, all_day, start_time, end_time, category, notes,
                             rec_type, rec_weekdays, rec_until, exceptions, sync_state, google_event_id)
         values ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11::int[], $12::date, $13::text[], $14, $15)`,
        [id, userId, e.titulo, e.data, e.diaInteiro, e.inicio || null, e.fim || null, e.categoria, e.notas,
         e.rec.tipo, e.rec.dias, e.rec.ate || null, e.excecoes, estadoSync, id.replaceAll('-', '')]
      )
      return this.obter(userId, id)
    },
    // `completo` já traz o evento mesclado (campos antigos + alterações), validado pela rota.
    async atualizar(userId, id, e, estadoSync) {
      const ok = await atualizarCampos(db, 'events', userId, id, {
        title: [e.titulo],
        date: [e.data, 'date'],
        all_day: [e.diaInteiro],
        start_time: [e.inicio || null],
        end_time: [e.fim || null],
        category: [e.categoria],
        notes: [e.notas],
        rec_type: [e.rec.tipo],
        rec_weekdays: [e.rec.dias, 'int[]'],
        rec_until: [e.rec.ate || null, 'date'],
        exceptions: [e.excecoes, 'text[]'],
        sync_state: [estadoSync],
        sync_error: [null]
      })
      return ok ? this.obter(userId, id) : null
    },
    async excluirDefinitivo(userId, id) {
      const r = await db.query('delete from events where id = $1 and user_id = $2 returning id', [id, userId])
      return r.length > 0
    },
    async marcarParaExclusao(userId, id) {
      await db.query(
        `update events set deleted_at = now(), sync_state = 'pending_delete', sync_error = null, updated_at = now()
          where id = $1 and user_id = $2`,
        [id, userId]
      )
    },
    async importar(userId, lote, estadoSync) {
      if (!lote.length) return { recebidos: 0, importados: 0 }
      const [r] = await db.query(
        `with entrada as (
           select * from jsonb_to_recordset($2::jsonb)
             as t(client_id text, titulo text, data date, dia_inteiro boolean, inicio text, fim text,
                  categoria text, notas text, rec_tipo text, rec_dias int[], rec_ate date, excecoes text[])
         ),
         preparado as (select gen_random_uuid() as novo_id, entrada.* from entrada),
         novos as (
           insert into events (id, user_id, client_id, title, date, all_day, start_time, end_time, category, notes,
                               rec_type, rec_weekdays, rec_until, exceptions, sync_state, google_event_id)
           select novo_id, $1::uuid, client_id, titulo, data, dia_inteiro, nullif(inicio, ''), nullif(fim, ''), categoria,
                  coalesce(notas, ''), rec_tipo, coalesce(rec_dias, '{}'), rec_ate, coalesce(excecoes, '{}'), $3::text,
                  replace(novo_id::text, '-', '')
             from preparado
           on conflict (user_id, client_id) do nothing
           returning 1
         )
         select (select count(*) from entrada)::int as recebidos, (select count(*) from novos)::int as importados`,
        [userId, JSON.stringify(lote), estadoSync]
      )
      return r
    },

    /* ---------- Sincronização com o Google ---------- */

    async pendentes(userId) {
      return db.query(
        `${SELECT} where user_id = $1 and sync_state in ('local','pending','error','pending_delete') order by updated_at limit 200`,
        [userId]
      )
    },
    async porGoogleId(userId, googleId) {
      const [r] = await db.query(`${SELECT} where user_id = $1 and google_event_id = $2`, [userId, googleId])
      return r ?? null
    },
    async marcarSincronizado(userId, id, { googleId, etag, atualizadoEm }) {
      await db.query(
        `update events set google_event_id = $3, google_etag = $4, google_updated = $5::timestamptz,
                sync_state = case when unsupported_recurrence then 'readonly' else 'synced' end, sync_error = null
          where id = $1 and user_id = $2`,
        [id, userId, googleId, etag ?? null, atualizadoEm ?? null]
      )
    },
    async marcarErro(userId, id, mensagem, estado = 'error') {
      await db.query(
        // Exclusão pendente nunca é rebaixada: o evento não pode "ressuscitar" por causa de uma falha de rede.
        `update events set sync_state = case when sync_state = 'pending_delete' then 'pending_delete' else $3 end, sync_error = $4
          where id = $1 and user_id = $2`,
        [id, userId, estado, String(mensagem).slice(0, 300)]
      )
    },
    // Dados vindos do Google substituem os locais (o Google é a fonte nesse momento).
    async aplicarDoGoogle(userId, id, e, meta) {
      await db.query(
        `update events set title = $3, date = $4::date, all_day = $5, start_time = $6, end_time = $7, notes = $8,
                rec_type = $9, rec_weekdays = $10::int[], rec_until = $11::date, exceptions = $12::text[],
                category = coalesce($13, category),
                google_etag = $14, google_updated = $15::timestamptz, unsupported_recurrence = $16,
                sync_state = case when $16 then 'readonly' else 'synced' end, sync_error = null,
                deleted_at = null, updated_at = now()
          where id = $1 and user_id = $2`,
        [id, userId, e.titulo, e.data, e.diaInteiro, e.inicio || null, e.fim || null, e.notas,
         e.rec.tipo, e.rec.dias, e.rec.ate || null, e.excecoes, e.categoria ?? null,
         meta.etag ?? null, meta.atualizadoEm ?? null, Boolean(meta.naoSuportada)]
      )
    },
    async inserirDoGoogle(userId, e, meta) {
      await db.query(
        `insert into events (user_id, title, date, all_day, start_time, end_time, category, notes, rec_type,
                             rec_weekdays, rec_until, exceptions, google_event_id, google_etag, google_updated,
                             unsupported_recurrence, sync_state)
         values ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10::int[], $11::date, $12::text[], $13, $14,
                 $15::timestamptz, $16, case when $16 then 'readonly' else 'synced' end)
         on conflict (user_id, google_event_id) do nothing`,
        [userId, e.titulo, e.data, e.diaInteiro, e.inicio || null, e.fim || null, e.categoria ?? 'pessoal', e.notas,
         e.rec.tipo, e.rec.dias, e.rec.ate || null, e.excecoes, meta.googleId, meta.etag ?? null,
         meta.atualizadoEm ?? null, Boolean(meta.naoSuportada)]
      )
    },
    async atualizarEtag(userId, id, etag) {
      await db.query('update events set google_etag = $3 where id = $1 and user_id = $2', [id, userId, etag])
    },
    async acrescentarExcecao(userId, googleId, dia) {
      await db.query(
        `update events set exceptions = array_append(exceptions, $3)
          where user_id = $1 and google_event_id = $2 and not ($3 = any(exceptions))`,
        [userId, googleId, dia]
      )
    },
    async excluirPorGoogleId(userId, googleId) {
      await db.query('delete from events where user_id = $1 and google_event_id = $2', [userId, googleId])
    },
    // Após uma sincronização completa: eventos já sincronizados que não vieram na listagem foram apagados no Google.
    async reconciliarAusentes(userId, vistos, dataMinima) {
      const r = await db.query(
        `delete from events
          where user_id = $1 and sync_state in ('synced','readonly') and google_event_id is not null
            and not (google_event_id = any($2::text[]))
            and ((rec_type = 'nenhuma' and date >= $3::date) or (rec_type <> 'nenhuma' and (rec_until is null or rec_until >= $3::date)))
          returning id`,
        [userId, vistos, dataMinima]
      )
      return r.length
    },
    async desvincularTodos(userId) {
      await db.query(`delete from events where user_id = $1 and sync_state = 'pending_delete'`, [userId])
      await db.query(
        `update events set sync_state = 'local', sync_error = null
          where user_id = $1 and sync_state in ('synced','pending','error')`,
        [userId]
      )
    },
    async contarPorEstado(userId) {
      const l = await db.query(
        `select sync_state, count(*)::int as n from events where user_id = $1 and deleted_at is null group by sync_state`,
        [userId]
      )
      return Object.fromEntries(l.map((x) => [x.sync_state, x.n]))
    }
  }
}
