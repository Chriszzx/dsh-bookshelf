import { apply } from '../../index.js'

export function applyTestHost(ctx, options) {
  return apply({
    connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
    ...ctx,
  }, options)
}
