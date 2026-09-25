// 오목판을 LLM이 읽기 좋은 형태로 가공하고, 수읽기로 답이 정해지는 수는 코드가 직접 고른다.
// LLM은 강제수가 없는 국면에서 후보 중 하나를 고르는 "포석 판단"만 담당한다.

import { BOARD_SIZE, type Cell, type Position, type Stone } from '../core/types'

export type ThreatTag = 'five' | 'openFour' | 'four' | 'openThree' | 'three'

export type PointThreat = {
  tag: ThreatTag
  /** 서로 다른 두 방향에서 동시에 열린3 이상이 생기는 자리. 상대가 한 수로 모두 막을 수 없다. */
  fork: boolean
}

export type Candidate = {
  id: string
  position: Position
  mine: PointThreat | null
  theirs: PointThreat | null
}

export type ForcedMove = { position: Position; reason: string }

const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]] as const
const THREAT_RANK: Record<ThreatTag, number> = { five: 5, openFour: 4, four: 3, openThree: 2, three: 1 }
const THREAT_LABEL: Record<ThreatTag, string> = {
  five: '5목완성', openFour: '열린4', four: '4', openThree: '열린3', three: '3',
}
// 후보를 알파벳 ID로 넘기므로 개수가 곧 enum 크기다. 너무 많으면 모델 판단이 흐려져 상위 20개만 쓴다.
const CANDIDATE_IDS = 'ABCDEFGHIJKLMNOPQRST'
const CANDIDATE_RADIUS = 2
const CENTER = (BOARD_SIZE - 1) / 2

export const otherStone = (stone: Stone): Stone => stone === 'black' ? 'white' : 'black'
export const pointKey = ({ row, col }: Position) => `${row},${col}`
const inBounds = (row: number, col: number) => row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE
const symbolOf = (stone: Stone) => stone === 'black' ? 'X' : 'O'
const centerDistance = ({ row, col }: Position) => Math.abs(row - CENTER) + Math.abs(col - CENTER)

/** (row,col)에 stone을 놓았다고 가정했을 때 한 방향 라인의 연속 길이와 열린 끝 개수. */
function lineAt(board: Cell[][], position: Position, rowDelta: number, colDelta: number, stone: Stone) {
  let count = 1
  let openEnds = 0
  // 내 돌과 빈 칸만 세어 이 방향에서 5목이 물리적으로 가능한지 본다.
  let span = 1
  for (const sign of [1, -1]) {
    let row = position.row + rowDelta * sign
    let col = position.col + colDelta * sign
    while (inBounds(row, col) && board[row][col] === stone) {
      count += 1
      row += rowDelta * sign
      col += colDelta * sign
    }
    if (inBounds(row, col) && board[row][col] === null) openEnds += 1

    let spanRow = position.row + rowDelta * sign
    let spanCol = position.col + colDelta * sign
    while (inBounds(spanRow, spanCol) && board[spanRow][spanCol] !== otherStone(stone)) {
      span += 1
      spanRow += rowDelta * sign
      spanCol += colDelta * sign
    }
  }
  return { count, openEnds, span }
}

function tagFor(count: number, openEnds: number, span: number): ThreatTag | null {
  // 상대 돌과 판 끝에 갇혀 5목을 놓을 자리 자체가 없으면 위협이 아니다.
  if (span < 5) return null
  if (count >= 5) return 'five'
  // 양끝이 모두 막힌 4·3은 더 늘릴 수 없으므로 위협이 아니다.
  if (count === 4) return openEnds === 2 ? 'openFour' : openEnds === 1 ? 'four' : null
  if (count === 3) return openEnds === 2 ? 'openThree' : openEnds === 1 ? 'three' : null
  return null
}

/** 빈 자리 하나에 stone을 놓았을 때 생기는 최고 위협과 동시 위협(fork) 여부. */
export function threatAt(board: Cell[][], position: Position, stone: Stone): PointThreat | null {
  if (board[position.row][position.col] !== null) return null
  let best: ThreatTag | null = null
  let strongDirections = 0
  for (const [rowDelta, colDelta] of DIRECTIONS) {
    const { count, openEnds, span } = lineAt(board, position, rowDelta, colDelta, stone)
    const tag = tagFor(count, openEnds, span)
    if (!tag) continue
    if (THREAT_RANK[tag] >= THREAT_RANK.openThree) strongDirections += 1
    if (!best || THREAT_RANK[tag] > THREAT_RANK[best]) best = tag
  }
  return best ? { tag: best, fork: strongDirections >= 2 } : null
}

/** 빈 자리마다 stone의 위협을 계산한 표. 키는 "row,col". */
export function threatMap(board: Cell[][], stone: Stone): Map<string, PointThreat> {
  const map = new Map<string, PointThreat>()
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const threat = threatAt(board, { row, col }, stone)
      if (threat) map.set(pointKey({ row, col }), threat)
    }
  }
  return map
}

/** 기존 돌에서 반경 안에 있는 빈 자리만 후보로 좁힌다. 빈 판이면 천원. */
export function nearbyEmptyPoints(board: Cell[][], radius = CANDIDATE_RADIUS): Position[] {
  const points = new Map<string, Position>()
  let hasStone = false
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col] === null) continue
      hasStone = true
      for (let rowDelta = -radius; rowDelta <= radius; rowDelta += 1) {
        for (let colDelta = -radius; colDelta <= radius; colDelta += 1) {
          const next = { row: row + rowDelta, col: col + colDelta }
          if (!inBounds(next.row, next.col) || board[next.row][next.col] !== null) continue
          points.set(pointKey(next), next)
        }
      }
    }
  }
  if (!hasStone) return [{ row: CENTER, col: CENTER }]
  return [...points.values()]
}

const threatWeight = (threat: PointThreat | null) =>
  threat ? THREAT_RANK[threat.tag] * 2 + (threat.fork ? 3 : 0) : 0

/** 공격 가치와 수비 가치를 함께 보되 더 급한 쪽을 우선한다. */
const candidateScore = (candidate: Candidate) => {
  const mine = threatWeight(candidate.mine)
  const theirs = threatWeight(candidate.theirs)
  return Math.max(mine, theirs) * 4 + Math.min(mine, theirs)
}

/** 위협도 순으로 정렬해 ID를 붙인 후보 목록. LLM에는 이 ID만 고르게 한다. */
export function buildCandidates(board: Cell[][], aiColor: Stone): Candidate[] {
  const opponent = otherStone(aiColor)
  const mineMap = threatMap(board, aiColor)
  const theirsMap = threatMap(board, opponent)
  return nearbyEmptyPoints(board)
    .map((position) => ({
      id: '',
      position,
      mine: mineMap.get(pointKey(position)) ?? null,
      theirs: theirsMap.get(pointKey(position)) ?? null,
    }))
    .sort((left, right) =>
      candidateScore(right) - candidateScore(left)
      || centerDistance(left.position) - centerDistance(right.position)
      || left.position.row - right.position.row
      || left.position.col - right.position.col)
    .slice(0, CANDIDATE_IDS.length)
    .map((candidate, index) => ({ ...candidate, id: CANDIDATE_IDS[index] }))
}

/** 행·열 번호가 붙은 ASCII 격자. 좌표 목록보다 공간 관계를 훨씬 잘 읽는다. */
export function renderBoard(board: Cell[][]): string {
  const columns = Array.from({ length: BOARD_SIZE }, (_, index) => String(index).padStart(2))
  const header = `${' '.repeat(4)}${columns.join(' ')}`
  const rows = board.map((cells, rowIndex) => {
    const rendered = cells.map((cell) => (cell ? symbolOf(cell) : '.').padStart(2)).join(' ')
    return `${String(rowIndex).padStart(2)}  ${rendered}`
  })
  return [header, ...rows].join('\n')
}

const describeThreat = (threat: PointThreat | null) =>
  threat ? `${THREAT_LABEL[threat.tag]}${threat.fork ? '(양수걸침)' : ''}` : '-'

/** 후보를 "A (7,8)  내:열린3  상대:-" 형태로 나열한다. */
export function renderCandidates(candidates: Candidate[]): string {
  return candidates
    .map(({ id, position, mine, theirs }) =>
      ` ${id}: (${position.row},${position.col})`.padEnd(14)
      + ` 내:${describeThreat(mine)}`.padEnd(16)
      + ` 상대:${describeThreat(theirs)}`)
    .join('\n')
}

/** 최근 수순. 상대의 의도를 읽는 데 좌표 목록보다 유용하다. */
export function renderRecentMoves(moves: Position[] | undefined, board: Cell[][]): string {
  if (!moves?.length) return ''
  return moves
    .slice(-8)
    .map(({ row, col }) => {
      const cell = board[row]?.[col]
      return `${cell ? symbolOf(cell) : '?'}(${row},${col})`
    })
    .join(' → ')
}

function openingReply(board: Cell[][]): Position | null {
  const stones: Position[] = []
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col] !== null) stones.push({ row, col })
    }
  }
  if (stones.length !== 1) return null
  const [first] = stones
  // 첫 응수는 대각 인접이 정석이다. 그중 중앙에 가까운 쪽을 고른다.
  const diagonals = [[1, 1], [1, -1], [-1, 1], [-1, -1]]
    .map(([rowDelta, colDelta]) => ({ row: first.row + rowDelta, col: first.col + colDelta }))
    .filter(({ row, col }) => inBounds(row, col) && board[row][col] === null)
    .sort((left, right) => centerDistance(left) - centerDistance(right))
  return diagonals[0] ?? null
}

/**
 * 답이 하나로 정해지는 국면은 LLM을 부르지 않고 코드가 결정한다.
 * 순서: 내 5목 > 상대 5목 차단 > 내 열린4 > 상대 열린4 차단 > 내 양수걸침 > 상대 양수걸침 차단.
 */
export function decideForcedMove(board: Cell[][], aiColor: Stone): ForcedMove | null {
  const opening = openingReply(board)
  if (opening) return { position: opening, reason: '정석 첫 응수' }

  const opponent = otherStone(aiColor)
  const mine = threatMap(board, aiColor)
  const theirs = threatMap(board, opponent)

  const pick = (map: Map<string, PointThreat>, match: (threat: PointThreat) => boolean) => {
    const hits = [...map.entries()].filter(([, threat]) => match(threat))
    if (!hits.length) return null
    // 같은 등급이 여러 곳이면 중앙에 가까운 쪽이 이후 전개에 유리하다.
    hits.sort(([leftKey], [rightKey]) => {
      const left = leftKey.split(',').map(Number)
      const right = rightKey.split(',').map(Number)
      return centerDistance({ row: left[0], col: left[1] }) - centerDistance({ row: right[0], col: right[1] })
    })
    const [row, col] = hits[0][0].split(',').map(Number)
    return { row, col }
  }

  const ladder: Array<[Map<string, PointThreat>, (threat: PointThreat) => boolean, string]> = [
    [mine, (threat) => threat.tag === 'five', '내가 5목을 완성'],
    [theirs, (threat) => threat.tag === 'five', '상대의 5목을 차단'],
    [mine, (threat) => threat.tag === 'openFour', '내가 열린4를 형성'],
    [theirs, (threat) => threat.tag === 'openFour', '상대의 열린4를 차단'],
    [mine, (threat) => threat.fork, '내가 양수걸침을 형성'],
    [theirs, (threat) => threat.fork, '상대의 양수걸침을 차단'],
  ]

  for (const [map, match, reason] of ladder) {
    const position = pick(map, match)
    if (position) return { position, reason }
  }
  return null
}
