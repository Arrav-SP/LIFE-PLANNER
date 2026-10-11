import { toCSV } from './export'

describe('toCSV', () => {
  it('quotes, flattens objects, drops user_id and neutralises formulas', () => {
    const csv = toCSV([{ id: '1', user_id: 'u', title: 'Hello, "world"', tags: ['a'], note: '=SUM(A1)' }])
    expect(csv).toBe('id,title,tags,note\r\n1,"Hello, ""world""","[""a""]",\'=SUM(A1)\r\n')
  })
})
