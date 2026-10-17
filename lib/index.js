/**
 * dsh-confetti · Host half.
 *
 * The effect is entirely Client-side (the browser owns the canvas and the
 * Session list it watches), so this entry only needs to exist: `dsh.client`
 * discovery walks the packages the Host loader composes, which means a bundle
 * with no Host registration at all would never have its Client half served.
 *
 * Keep it a no-op — no services injected, no routes, no tools.
 */

export const name = 'dsh-confetti'

/** No Host service is required; empty `inject` keeps activation unconditional. */
export const inject = []

export function apply() {}
