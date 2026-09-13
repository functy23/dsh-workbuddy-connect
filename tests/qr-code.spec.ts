import { describe, expect, it } from 'vitest'
import { encodeQrCode, isDarkQrModule, maskPenalties } from '../src/client/qr-code.ts'

/**
 * The QR encoder, against golden symbols produced by a reference implementation.
 *
 * Why golden matrices rather than property checks: a QR symbol that is merely
 * *plausible* — right size, finder patterns in the right places — scans as
 * garbage, and the failure surfaces on a phone rather than in CI. The only
 * useful assertion is "these modules, exactly", so the expected symbol for each
 * payload is written out and compared module by module.
 *
 * The vectors were produced by the `qrcode` npm package (v1.5.4, error
 * correction level M) and independently confirmed to agree across a 249-payload
 * byte-mode corpus, including the automatic mask choice. They are inlined rather
 * than generated at test time so the suite has no QR dependency and cannot drift
 * with a dependency's behaviour.
 */

/** Render a symbol as rows of \`1\`/\`0\`, which is how the vectors are written. */
function rows(code: ReturnType<typeof encodeQrCode>): string[] {
  const out: string[] = []
  for (let y = 0; y < code.size; y += 1) {
    let row = ''
    for (let x = 0; x < code.size; x += 1) row += isDarkQrModule(code, x, y) ? '1' : '0'
    out.push(row)
  }
  return out
}

/** Parse a golden vector, asserting it is square as it goes. */
function fromRows(rows: readonly string[]): { size: number, dark: Set<string> } {
  const size = rows.length
  const dark = new Set<string>()
  rows.forEach((row, y) => {
    expect(row.length).toBe(size)
    for (let x = 0; x < size; x += 1) if (row[x] === '1') dark.add(`${String(x)},${String(y)}`)
  })
  return { size, dark }
}

const QR_A = fromRows([
  '111111100101101111111',
  '100000101011001000001',
  '101110101101001011101',
  '101110101011001011101',
  '101110100100101011101',
  '100000100011001000001',
  '111111101010101111111',
  '000000001100000000000',
  '100000101011011001110',
  '100110000001110111001',
  '001011100110101100000',
  '010101011001111101010',
  '110100111101111111111',
  '000000001100100000101',
  '111111100111010011110',
  '100000100010001000111',
  '101110100111010011100',
  '101110100101111101000',
  '101110100101110111011',
  '100000100011111101000',
  '111111101010100100110',
])

const QR_URL = fromRows([
  '111111100000010011111001001111111',
  '100000100011000100001110101000001',
  '101110101110101110001100001011101',
  '101110101011101011001111101011101',
  '101110101111011111110000001011101',
  '100000101110011101001010001000001',
  '111111101010101010101010101111111',
  '000000001011001100101111100000000',
  '101111100100111001000010101111100',
  '010110001100110010011011001101111',
  '101101101100010110101100010010100',
  '111110010101000010010110101011101',
  '000101100100000011000001110111011',
  '011111011110110110111100001001011',
  '101001100011000110000110011101010',
  '010100001101010000101100011001100',
  '110010110111010101100001110111001',
  '010110010111110000111101001101101',
  '100000111010001111100010111110110',
  '001011010011101110111100111111110',
  '100010100011110011011010010011001',
  '101101000100101001111011111000101',
  '101101100111011101001010000000110',
  '101100001101101000100100011101101',
  '100101100110101101000011111110011',
  '000000001000001010111111100010101',
  '111111100011101111101001101010110',
  '100000101101001010001111100011111',
  '101110101010100011100010111111010',
  '101110101011100000011111010011011',
  '101110101010111111100111001100100',
  '100000100001000100001100000011100',
  '111111101110100101000011101100010',
])

describe('QR encoder', () => {
  it('encodes one byte at version 1 exactly', () => {
    const code = encodeQrCode('a')
    expect(code.size).toBe(QR_A.size)
    // The comparison that matters: every module.
    for (let y = 0; y < QR_A.size; y += 1) {
      for (let x = 0; x < QR_A.size; x += 1) {
        expect(isDarkQrModule(code, x, y), `module ${String(x)},${String(y)}`).toBe(QR_A.dark.has(`${String(x)},${String(y)}`))
      }
    }
  })

  it('encodes a plugin-auth URL at version 4 exactly', () => {
    const code = encodeQrCode('https://copilot.tencent.com/login?platform=CLI&state=abc123XYZ')
    expect(code.size).toBe(QR_URL.size)
    for (let y = 0; y < QR_URL.size; y += 1) {
      for (let x = 0; x < QR_URL.size; x += 1) {
        expect(isDarkQrModule(code, x, y), `module ${String(x)},${String(y)}`).toBe(QR_URL.dark.has(`${String(x)},${String(y)}`))
      }
    }
  })

  it('places the three finder patterns and their separators', () => {
    const code = encodeQrCode('a')
    // The 7x7 finder: solid ring, light gap, solid 3x3 core.
    for (const [originX, originY] of [[0, 0], [14, 0], [0, 14]] as const) {
      for (let y = 0; y < 7; y += 1) {
        for (let x = 0; x < 7; x += 1) {
          const edge = x === 0 || x === 6 || y === 0 || y === 6
          const core = x >= 2 && x <= 4 && y >= 2 && y <= 4
          expect(isDarkQrModule(code, originX + x, originY + y), `${String(x)},${String(y)}`).toBe(edge || core)
        }
      }
    }
    // The separator beside each finder is entirely light: one module outside
    // the 7x7 pattern on the sides that face the data area.
    for (let index = 0; index < 8; index += 1) {
      // Top-left, facing right and down.
      expect(isDarkQrModule(code, 7, index)).toBe(false)
      expect(isDarkQrModule(code, index, 7)).toBe(false)
      // Top-right finder starts at column 14, so its separator is column 13.
      expect(isDarkQrModule(code, 13, index)).toBe(false)
      // Bottom-left finder starts at row 14, so its separator is row 13.
      expect(isDarkQrModule(code, index, 13)).toBe(false)
    }
  })

  it('alternates the timing patterns', () => {
    const code = encodeQrCode('a')
    for (let index = 8; index < 13; index += 1) {
      expect(isDarkQrModule(code, index, 6)).toBe(index % 2 === 0)
      expect(isDarkQrModule(code, 6, index)).toBe(index % 2 === 0)
    }
  })

  it('grows the symbol with the payload and switches the length field at v10', () => {
    // Version boundaries at level M in byte mode: 14, 26, 42 ... bytes.
    expect(encodeQrCode('a'.repeat(14)).size).toBe(21)
    expect(encodeQrCode('a'.repeat(15)).size).toBe(25)
    expect(encodeQrCode('a'.repeat(26)).size).toBe(25)
    expect(encodeQrCode('a'.repeat(27)).size).toBe(29)
    // Version 10 begins at 213 bytes, where the character-count field widens
    // from 8 bits to 16 — the one boundary a hand-written length field gets
    // wrong, and it is wrong only past 255 bytes.
    expect(encodeQrCode('a'.repeat(213)).size).toBe(57)
    expect(encodeQrCode('a'.repeat(214)).size).toBe(61)
    expect(encodeQrCode('a'.repeat(666)).size).toBe(4 * 20 + 17)
  })

  it('refuses a payload it cannot encode rather than truncating it', () => {
    expect(() => encodeQrCode('a'.repeat(667))).toThrow(/exceeds the supported capacity/)
  })

  it('always chooses the lowest-scoring mask', () => {
    for (const text of ['a', 'scan me', 'x'.repeat(40), 'https://www.workbuddy.ai/plugin/auth?state=q']) {
      const scores = maskPenalties(text)
      expect(scores).toHaveLength(8)
      const chosen = encodeQrCode(text)
      // Re-encode with the winning mask: it must reproduce the same symbol.
      const best = scores.indexOf(Math.min(...scores))
      expect(rows(encodeQrCode(text, { mask: best }))).toEqual(rows(chosen))
    }
  })

  it('treats out-of-range coordinates as light rather than throwing', () => {
    const code = encodeQrCode('a')
    expect(isDarkQrModule(code, -1, 0)).toBe(false)
    expect(isDarkQrModule(code, 0, -1)).toBe(false)
    expect(isDarkQrModule(code, code.size, 0)).toBe(false)
  })
})
