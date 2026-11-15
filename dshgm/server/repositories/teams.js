// Times, subtimes e colaboradores (modo profissional). Toda consulta filtra por user_id.
import { atualizarCampos } from './sql.js'

const SELECT_TIME = `select id, name, sector from teams`
const SELECT_SUB = `select id, team_id, name from team_subteams`
const SELECT_COLAB = `select id, team_id, subteam_id, name, role, strengths, improvements, events, profile from team_members`

const mapearTime = (r) => ({ id: r.id, nome: r.name, setor: r.sector })
const mapearSub = (r) => ({ id: r.id, timeId: r.team_id, nome: r.name })
const lista = (valor) => (Array.isArray(valor) ? valor : [])
const mapearColab = (r) => ({
  id: r.id,
  timeId: r.team_id,
  subtimeId: r.subteam_id ?? null,
  nome: r.name,
  cargo: r.role,
  pontosFortes: lista(r.strengths),
  pontosMelhoria: lista(r.improvements),
  eventos: lista(r.events),
  perfil: r.profile
})

export function criarRepoTimes(db) {
  return {
    // Tudo de uma vez: times com subtimes e colaboradores aninhados (são poucos registros por usuário).
    async listar(userId) {
      const [times, subtimes, colaboradores] = await Promise.all([
        db.query(`${SELECT_TIME} where user_id = $1 order by created_at, id`, [userId]),
        db.query(`${SELECT_SUB} where user_id = $1 order by created_at, id`, [userId]),
        db.query(`${SELECT_COLAB} where user_id = $1 order by lower(name), id`, [userId])
      ])
      return times.map((t) => ({
        ...mapearTime(t),
        subtimes: subtimes.filter((s) => s.team_id === t.id).map(mapearSub),
        colaboradores: colaboradores.filter((c) => c.team_id === t.id).map(mapearColab)
      }))
    },
    async contarTimes(userId) {
      const [r] = await db.query('select count(*)::int as n from teams where user_id = $1', [userId])
      return r.n
    },
    async contarColaboradores(userId) {
      const [r] = await db.query('select count(*)::int as n from team_members where user_id = $1', [userId])
      return r.n
    },

    /* ---------- Times ---------- */
    async obterTime(userId, id) {
      const [r] = await db.query(`${SELECT_TIME} where user_id = $1 and id = $2`, [userId, id])
      return r ? mapearTime(r) : null
    },
    async criarTime(userId, { nome, setor }) {
      const [{ id }] = await db.query('insert into teams (user_id, name, sector) values ($1, $2, $3) returning id', [userId, nome, setor])
      return { ...(await this.obterTime(userId, id)), subtimes: [], colaboradores: [] }
    },
    async atualizarTime(userId, id, c) {
      const mapa = {}
      if ('nome' in c) mapa.name = [c.nome]
      if ('setor' in c) mapa.sector = [c.setor]
      const ok = await atualizarCampos(db, 'teams', userId, id, mapa)
      return ok ? this.obterTime(userId, id) : null
    },
    // Exclui o time com subtimes e colaboradores (chaves estrangeiras em cascata).
    async excluirTime(userId, id) {
      const r = await db.query('delete from teams where id = $1 and user_id = $2 returning id', [id, userId])
      return r.length > 0
    },

    /* ---------- Subtimes ---------- */
    async obterSubtime(userId, id) {
      const [r] = await db.query(`${SELECT_SUB} where user_id = $1 and id = $2`, [userId, id])
      return r ? mapearSub(r) : null
    },
    async nomeDeSubtimeEmUso(userId, timeId, nome, ignorarId = null) {
      const l = await db.query(
        `select id from team_subteams where user_id = $1 and team_id = $2 and lower(name) = lower($3)
            and ($4::uuid is null or id <> $4::uuid)`,
        [userId, timeId, nome, ignorarId]
      )
      return l.length > 0
    },
    async criarSubtime(userId, timeId, nome) {
      const [{ id }] = await db.query('insert into team_subteams (user_id, team_id, name) values ($1, $2, $3) returning id', [userId, timeId, nome])
      return this.obterSubtime(userId, id)
    },
    async atualizarSubtime(userId, id, nome) {
      const ok = await atualizarCampos(db, 'team_subteams', userId, id, { name: [nome] })
      return ok ? this.obterSubtime(userId, id) : null
    },
    // As pessoas do subtime continuam no time (subteam_id vira nulo pela chave estrangeira).
    async excluirSubtime(userId, id) {
      const r = await db.query('delete from team_subteams where id = $1 and user_id = $2 returning id', [id, userId])
      return r.length > 0
    },

    /* ---------- Colaboradores ---------- */
    async obterColaborador(userId, id) {
      const [r] = await db.query(`${SELECT_COLAB} where user_id = $1 and id = $2`, [userId, id])
      return r ? mapearColab(r) : null
    },
    async criarColaborador(userId, timeId, c) {
      const [{ id }] = await db.query(
        `insert into team_members (user_id, team_id, subteam_id, name, role, strengths, improvements, events, profile)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9) returning id`,
        [userId, timeId, c.subtimeId ?? null, c.nome, c.cargo, JSON.stringify(c.pontosFortes), JSON.stringify(c.pontosMelhoria), JSON.stringify(c.eventos), c.perfil]
      )
      return this.obterColaborador(userId, id)
    },
    async atualizarColaborador(userId, id, c) {
      const mapa = {}
      if ('nome' in c) mapa.name = [c.nome]
      if ('cargo' in c) mapa.role = [c.cargo]
      if ('subtimeId' in c) mapa.subteam_id = [c.subtimeId, 'uuid']
      if ('pontosFortes' in c) mapa.strengths = [JSON.stringify(c.pontosFortes), 'jsonb']
      if ('pontosMelhoria' in c) mapa.improvements = [JSON.stringify(c.pontosMelhoria), 'jsonb']
      if ('eventos' in c) mapa.events = [JSON.stringify(c.eventos), 'jsonb']
      if ('perfil' in c) mapa.profile = [c.perfil]
      const ok = await atualizarCampos(db, 'team_members', userId, id, mapa)
      return ok ? this.obterColaborador(userId, id) : null
    },
    async excluirColaborador(userId, id) {
      const r = await db.query('delete from team_members where id = $1 and user_id = $2 returning id', [id, userId])
      return r.length > 0
    }
  }
}
