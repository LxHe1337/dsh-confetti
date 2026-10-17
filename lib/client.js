/**
 * dsh-confetti · Client half.
 *
 * Whenever a conversation finishes a turn, this plugin fires one party popper
 * out of the window's bottom-left corner and one out of its bottom-right
 * corner. A button in the composer's tool row fires the very same celebration
 * on demand. There is no build step: the file is the bundle the Client module
 * loader executes (`window.__ModuleLoader__.load({ id, factory })`). React is
 * pulled from the browser module table lazily and only for the button, so the
 * bundle still runs unchanged inside preview/confetti.html.
 *
 * The button is the plugin's only UI seat: `conversation.input.right` ("compact
 * controls before the composer submit action") allocates its space and its
 * lifetime, so the plugin never positions anything itself. The confetti canvas
 * is deliberately not a slot occupant — it owns no seat, is appended
 * imperatively on the first celebration, and is removed with the plugin.
 *
 * Completion signal: the Client Session list snapshot
 * (`ctx.get('sessions').list`) carries the authoritative per-Session run bit
 * (`byId[id].running`, the same field the shipped sidebar and the subagent
 * surfaces read). A `true → false` transition on a top-level Session means
 * exactly "that conversation's turn just closed" — no polling, no Host RPC.
 * Subagent children (`origin === 'subagent'` / `parentId`) are skipped so a
 * delegation burst does not machine-gun the screen.
 */

window.__ModuleLoader__.load({
  id: 'dsh-confetti',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var NAME = 'dsh-confetti'
    var VERSION = '0.2.0'

    /** Celebration colors: warm party palette that reads on light and dark shells. */
    var PALETTE = [
      '#ff477e', '#ffd166', '#06d6a0', '#4cc9f0',
      '#b388ff', '#ff9f1c', '#f72585', '#fff1b8',
    ]

    /** Hard ceiling on live pieces — a stuck loop can never eat the frame budget. */
    var MAX_PIECES = 640
    var Z_INDEX = '2147483000'

    /** The one canvas this run owns (module scope: one layer per page). */
    var layer = null
    /** Pending second wave of the current celebration. */
    var tailTimer = 0
    /** Pending first frame of `start()`. */
    var rafPending = false
    /** Activation log is per page, not per (re)activation. */
    var announced = false

    function clamp(value, min, max) {
      return value < min ? min : value > max ? max : value
    }

    function prefersReducedMotion() {
      try {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      } catch (error) {
        return false
      }
    }

    function hasDocument() {
      return typeof document !== 'undefined' && !!document.body
    }

    // ---------------------------------------------------------------- canvas

    function resizeLayer(target) {
      var dpr = clamp(window.devicePixelRatio || 1, 1, 2)
      var width = Math.max(1, Math.round(window.innerWidth || document.documentElement.clientWidth || 1))
      var height = Math.max(1, Math.round(window.innerHeight || document.documentElement.clientHeight || 1))
      target.dpr = dpr
      target.width = width
      target.height = height
      target.canvas.width = Math.round(width * dpr)
      target.canvas.height = Math.round(height * dpr)
      target.canvas.style.width = width + 'px'
      target.canvas.style.height = height + 'px'
      // Draw in CSS pixels; the transform maps them onto the device grid.
      target.c2d.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    function onWindowResize() {
      if (layer) resizeLayer(layer)
    }

    function ensureLayer() {
      if (layer && layer.canvas && layer.canvas.isConnected) {
        // A hidden tab can miss resize events; cheap to re-check here.
        if (layer.width !== Math.round(window.innerWidth) || layer.height !== Math.round(window.innerHeight)) {
          resizeLayer(layer)
        }
        return layer
      }
      if (!hasDocument()) return null
      var canvas = document.createElement('canvas')
      var c2d = canvas.getContext('2d')
      if (!c2d) return null
      canvas.setAttribute('aria-hidden', 'true')
      canvas.setAttribute('data-dsh-confetti', '')
      canvas.style.cssText =
        'position:fixed;left:0;top:0;pointer-events:none;display:block;' +
        'contain:layout paint;z-index:' + Z_INDEX + ';'
      document.body.appendChild(canvas)
      layer = { canvas: canvas, c2d: c2d, pieces: [], raf: 0, last: 0, dpr: 1, width: 1, height: 1 }
      resizeLayer(layer)
      try {
        window.addEventListener('resize', onWindowResize)
      } catch (error) {
        /* no-op: resize is also re-checked on the next celebration */
      }
      return layer
    }

    function destroyLayer() {
      if (tailTimer) {
        window.clearTimeout(tailTimer)
        tailTimer = 0
      }
      if (!layer) return
      var target = layer
      layer = null
      rafPending = false
      try {
        window.removeEventListener('resize', onWindowResize)
      } catch (error) {
        /* no-op */
      }
      if (target.raf) {
        try {
          window.cancelAnimationFrame(target.raf)
        } catch (error) {
          /* no-op */
        }
        target.raf = 0
      }
      target.pieces.length = 0
      try {
        if (target.canvas.parentNode) target.canvas.parentNode.removeChild(target.canvas)
      } catch (error) {
        /* no-op */
      }
    }

    function clearCanvas(target) {
      try {
        target.c2d.clearRect(0, 0, target.width, target.height)
      } catch (error) {
        /* a detached canvas never needs clearing */
      }
    }

    // ------------------------------------------------------------- particles

    /**
     * Push one corner's burst.
     *
     * @param target  the live layer
     * @param side    'left' | 'right'
     * @param count   how many pieces
     * @param scale   1 = normal, <1 = the lighter follow-up wave
     */
    function spawnBurst(target, side, count, scale) {
      var room = MAX_PIECES - target.pieces.length
      if (room <= 0) return
      if (count > room) count = room

      var fromLeft = side === 'left'
      var width = target.width
      var height = target.height
      var originX = fromLeft ? -6 : width + 6
      var originY = height + 10
      // Screen space: -PI/2 is straight up. Left corner shoots up-and-right,
      // right corner up-and-left, so both arcs cross the frame.
      var baseAngle = fromLeft ? -Math.PI * 0.32 : -Math.PI * 0.68
      var inward = fromLeft ? 1 : -1
      // A big display needs a longer throw and bigger paper for the same read;
      // 1280x800 is the reference size the numbers below were tuned on.
      var gauge = clamp(Math.sqrt((width * height) / 1024000), 0.82, 1.5)

      for (var i = 0; i < count; i += 1) {
        var roll = Math.random()
        var shape = roll < 0.6 ? 'ribbon' : roll < 0.84 ? 'dot' : 'streamer'
        var angle = baseAngle + (Math.random() - 0.5) * 0.5
        var speed = (22 + Math.random() * 17) * scale * gauge
        var pieceWidth = (shape === 'streamer' ? 2.8 + Math.random() * 1.8 : 6 + Math.random() * 7.5) * gauge
        var pieceHeight = (shape === 'streamer' ? 18 + Math.random() * 18 : shape === 'dot' ? 0 : 8.5 + Math.random() * 8.5) * gauge

        target.pieces.push({
          x: originX + inward * Math.random() * 52 * gauge,
          y: originY - Math.random() * 22 * gauge,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          gravity: 0.42 + Math.random() * 0.22,
          drag: 0.986 + Math.random() * 0.009,
          rot: Math.random() * Math.PI * 2,
          spin: (Math.random() - 0.5) * 0.46,
          flip: Math.random() * Math.PI * 2,
          flipSpeed: 0.15 + Math.random() * 0.26,
          sway: Math.random() * Math.PI * 2,
          swaySpeed: 0.06 + Math.random() * 0.09,
          swayAmount: (0.9 + Math.random() * 2.4) * gauge,
          shape: shape,
          w: pieceWidth,
          h: pieceHeight,
          radius: shape === 'dot' ? (2.8 + Math.random() * 2.8) * gauge : 0,
          color: PALETTE[(Math.random() * PALETTE.length) | 0],
          alpha: 0.82 + Math.random() * 0.18,
          life: 0,
          ttl: 2.8 + Math.random() * 1.4,
        })
      }
    }

    function stepPieces(target, dt) {
      // Speeds are authored per 60 Hz frame; `k` maps them onto real time so a
      // 144 Hz display and a throttled background tab show the same arc.
      var k = dt * 60
      var alive = []
      for (var i = 0; i < target.pieces.length; i += 1) {
        var piece = target.pieces[i]
        piece.life += dt
        if (piece.life >= piece.ttl) continue

        var damp = Math.pow(piece.drag, k)
        piece.vy += piece.gravity * k
        piece.vx *= damp
        piece.vy *= damp
        piece.x += piece.vx * k + Math.sin(piece.sway) * piece.swayAmount * k
        piece.y += piece.vy * k
        piece.rot += piece.spin * k
        piece.flip += piece.flipSpeed * k
        piece.sway += piece.swaySpeed * k

        if (piece.y > target.height + 60 || piece.x < -120 || piece.x > target.width + 120) continue
        alive.push(piece)
      }
      target.pieces = alive
    }

    function drawPieces(target) {
      var c2d = target.c2d
      c2d.clearRect(0, 0, target.width, target.height)
      for (var i = 0; i < target.pieces.length; i += 1) {
        var piece = target.pieces[i]
        var fadeIn = Math.min(1, piece.life / 0.06)
        var fadeOut = Math.min(1, Math.max(0, (piece.ttl - piece.life) / 0.6))
        var alpha = fadeIn * fadeOut * piece.alpha
        if (alpha <= 0.01) continue

        c2d.globalAlpha = alpha
        c2d.save()
        c2d.translate(piece.x, piece.y)
        c2d.rotate(piece.rot)
        // Flipping the vertical axis around zero fakes a spinning paper ribbon.
        var squash = Math.cos(piece.flip)
        c2d.scale(1, Math.max(0.14, Math.abs(squash)))
        c2d.fillStyle = piece.color
        if (piece.shape === 'dot') {
          c2d.beginPath()
          c2d.arc(0, 0, piece.radius, 0, Math.PI * 2)
          c2d.fill()
        } else {
          c2d.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h)
        }
        c2d.restore()
      }
      c2d.globalAlpha = 1
    }

    function startLoop(target) {
      if (target.raf || rafPending) return
      rafPending = true
      target.last = 0

      var frame = function (now) {
        rafPending = false
        if (layer !== target || !target.canvas || !target.canvas.isConnected) return
        var dt = target.last ? Math.min(0.048, (now - target.last) / 1000) : 1 / 60
        target.last = now
        stepPieces(target, dt)
        drawPieces(target)
        if (target.pieces.length > 0) {
          target.raf = window.requestAnimationFrame(frame)
        } else {
          target.raf = 0
          target.last = 0
          clearCanvas(target)
        }
      }

      target.raf = window.requestAnimationFrame(frame)
    }

    /**
     * Fire one celebration: a popper in each bottom corner, plus a lighter
     * follow-up wave so the burst reads as a party cracker rather than a puff.
     *
     * @param options `{ density }` — 1 is the default strength.
     */
    function fire(options) {
      if (!hasDocument()) return
      var target = ensureLayer()
      if (!target) return

      var settings = options && typeof options === 'object' ? options : {}
      var density = typeof settings.density === 'number' && isFinite(settings.density)
        ? clamp(settings.density, 0.25, 3)
        : 1
      var reduced = prefersReducedMotion()
      var base = reduced ? 18 : 68
      var count = Math.round(base * density)

      spawnBurst(target, 'left', count, 1)
      spawnBurst(target, 'right', count, 1)

      if (!reduced) {
        if (tailTimer) window.clearTimeout(tailTimer)
        var tail = Math.round(count * 0.34)
        tailTimer = window.setTimeout(function () {
          tailTimer = 0
          if (!layer || layer !== target) return
          spawnBurst(target, 'left', tail, 0.76)
          spawnBurst(target, 'right', tail, 0.76)
          startLoop(target)
        }, 150)
      }

      startLoop(target)
    }

    // -------------------------------------------------- manual trigger (button)

    var LOCALE_NS = 'dsh-confetti'

    /** Same words as the tooltip and the aria-label; registered through the locale service. */
    var DICTIONARIES = {
      zh: {
        button: '撒彩带',
        hint: '手动撒一把彩带（每轮对话结束时也会自动撒）',
      },
      en: {
        button: 'Confetti',
        hint: 'Throw confetti now (a completed turn does it too)',
      },
    }

    /** Local to the component: no stylesheet registry needed, unmounting removes it. */
    var BUTTON_CSS = [
      '.dsh-confetti-button{display:inline-flex;align-items:center;justify-content:center;',
      'width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;',
      'color:var(--dsw-alias-label-secondary,#8e8e8e);cursor:pointer;line-height:1;',
      'font-size:15px;transition:background .15s ease,transform .15s ease}',
      '.dsh-confetti-button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));',
      'transform:translateY(-1px)}',
      '.dsh-confetti-button:active{transform:translateY(0) scale(.94)}',
      '.dsh-confetti-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);',
      'outline-offset:1px}',
      '.dsh-confetti-button-glyph{font-size:15px;line-height:1}',
      '@media (prefers-reduced-motion:reduce){.dsh-confetti-button{transition:none}',
      '.dsh-confetti-button:hover{transform:none}}',
    ].join('')

    var reactLibrary = null
    var reactTried = false

    /**
     * React is baseline in the browser module table but absent in the standalone
     * preview, so the requirement stays lazy and its failure is non-fatal: the
     * button is skipped, the confetti engine still works.
     */
    function loadReact() {
      if (reactTried) return reactLibrary
      reactTried = true
      try {
        var candidate = require('react')
        if (candidate && typeof candidate.createElement === 'function') reactLibrary = candidate
      } catch (error) {
        reactLibrary = null
      }
      return reactLibrary
    }

    /**
     * Visible text goes through the Client locale service when it is there.
     * Returns a `t(key)` function either way, so the button never renders an
     * untranslated key or fails because the dictionary registry is missing.
     */
    function translator(ctx) {
      var locale = null
      try {
        locale = ctx.get('locale')
      } catch (error) {
        locale = null
      }
      if (locale && typeof locale.register === 'function' && typeof locale.bind === 'function') {
        try {
          var registered = function () {
            return locale.register(LOCALE_NS, DICTIONARIES)
          }
          if (ctx && typeof ctx.effect === 'function') ctx.effect(registered)
          else registered()
          var bound = locale.bind(LOCALE_NS)
          if (typeof bound === 'function') return bound
        } catch (error) {
          /* fall through to the literal dictionary */
        }
      }
      var language = ''
      try {
        language = String((typeof navigator !== 'undefined' && navigator.language) || '')
      } catch (error) {
        language = ''
      }
      var fallback = /^zh/i.test(language) ? DICTIONARIES.zh : DICTIONARIES.en
      return function (key) {
        return fallback[key] || key
      }
    }

    /**
     * Pure render: no hooks, so the component is safe in any slot render path
     * and inspectable without a reconciler.
     */
    function createButton(React, t, onPress) {
      return function ConfettiButton() {
        return React.createElement(
          React.Fragment,
          null,
          React.createElement('style', { key: 'css' }, BUTTON_CSS),
          React.createElement(
            'button',
            {
              key: 'button',
              type: 'button',
              className: 'dsh-confetti-button',
              title: t('hint'),
              'aria-label': t('button'),
              onClick: function (event) {
                if (event && typeof event.preventDefault === 'function') event.preventDefault()
                if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
                onPress()
              },
            },
            React.createElement(
              'span',
              { className: 'dsh-confetti-button-glyph', 'aria-hidden': 'true' },
              '\uD83C\uDF89',
            ),
          ),
        )
      }
    }

    /**
     * Seats the button beside the shipped composer controls. The slot owns both
     * placement and lifetime, so `slots.inject` is the whole registration —
     * a slot this shell does not declare simply never runs the callback.
     */
    function registerButton(ctx, onPress) {
      if (!ctx || !ctx.slots) return false
      if (typeof ctx.slots.inject !== 'function' || typeof ctx.slots.register !== 'function') return false
      var React = loadReact()
      if (!React) return false
      var t = translator(ctx)
      var Component = createButton(React, t, onPress)
      try {
        ctx.slots.inject('conversation.input.right', function () {
          return ctx.slots.register(
            {
              name: 'conversation.input.right',
              id: 'dsh-confetti',
              order: 10,
              label: function () {
                return t('button')
              },
            },
            Component,
          )
        })
        return true
      } catch (error) {
        try {
          console.warn('[dsh-confetti] button registration failed:', error)
        } catch (nested) {
          /* no-op */
        }
        return false
      }
    }

    // ------------------------------------------------------------- activation

    function readOptions(config) {
      var options = { enabled: true, density: 1, button: true }
      if (config && typeof config === 'object') {
        if (config.enabled === false) options.enabled = false
        if (config.button === false) options.button = false
        if (typeof config.density === 'number' && isFinite(config.density)) {
          options.density = clamp(config.density, 0.25, 3)
        }
      }
      return options
    }

    function sessionList(ctx) {
      var sessions = null
      try {
        sessions = ctx.get('sessions')
      } catch (error) {
        sessions = null
      }
      var list = sessions && sessions.list
      if (!list) return null
      if (typeof list.getSnapshot !== 'function' || typeof list.subscribe !== 'function') return null
      return list
    }

    function registerDisposal(ctx, dispose) {
      if (ctx && typeof ctx.effect === 'function') {
        try {
          ctx.effect(function () {
            return dispose
          })
          return
        } catch (error) {
          /* fall through to the event form */
        }
      }
      if (ctx && typeof ctx.on === 'function') {
        try {
          ctx.on('dispose', dispose)
        } catch (error) {
          /* a context that cannot report disposal just leaves the canvas behind */
        }
      }
    }

    /**
     * Watch every Session's run bit and celebrate each top-level turn that
     * closes. A Session that appears already idle never fires: only an observed
     * `true → false` counts, so opening an old conversation stays quiet.
     */
    function apply(ctx, config) {
      var options = readOptions(config)
      if (options.enabled === false) return

      var disposed = false
      var primed = false
      // Null-prototype maps: Session ids are opaque strings and must never be
      // able to shadow an Object.prototype member.
      var previous = Object.create(null)
      var cooldownUntil = 0
      var retryTimer = 0
      var attempts = 0
      var unsubscribe = null
      var buttonSeated = false

      function finish() {
        if (disposed) return
        var now = Date.now()
        // Several Sessions can settle in the same tick (a fan-out finishing);
        // one celebration is enough and keeps the corners from machine-gunning.
        if (now < cooldownUntil) return
        cooldownUntil = now + 900
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
        fire(options)
      }

      function read() {
        if (disposed) return
        var list = sessionList(ctx)
        if (!list) return
        var snapshot = null
        try {
          snapshot = list.getSnapshot()
        } catch (error) {
          return
        }
        var byId = snapshot && snapshot.byId
        if (!byId) return

        var next = Object.create(null)
        var completed = false
        for (var id in byId) {
          if (!Object.prototype.hasOwnProperty.call(byId, id)) continue
          var summary = byId[id]
          var running = summary ? summary.running : undefined
          next[id] = running
          if (!primed) continue
          if (previous[id] !== true || running !== false) continue
          // Delegated children finishing is not "your conversation finished".
          if (summary && (summary.origin === 'subagent' || typeof summary.parentId === 'string')) continue
          completed = true
        }

        previous = next
        primed = true
        if (completed) finish()
      }

      function attach() {
        var list = sessionList(ctx)
        if (!list) return false
        try {
          unsubscribe = list.subscribe(read)
        } catch (error) {
          return false
        }
        if (typeof unsubscribe !== 'function') unsubscribe = null
        read()
        return true
      }

      if (!attach()) {
        // Services register in phases; wait for `sessions` to appear instead of
        // giving up on the first activation.
        retryTimer = window.setInterval(function () {
          attempts += 1
          if (disposed || attempts > 60) {
            window.clearInterval(retryTimer)
            retryTimer = 0
            return
          }
          if (attach()) {
            window.clearInterval(retryTimer)
            retryTimer = 0
          }
        }, 500)
      }

      if (options.button !== false && registerButton(ctx, function () {
        fire(options)
      })) {
        buttonSeated = true
      }

      if (!announced) {
        announced = true
        try {
          console.info(
            '[dsh-confetti] armed — every completed turn gets a popper in each bottom corner' +
              (buttonSeated ? '; press the confetti button in the composer to fire one now' : ''),
          )
        } catch (error) {
          /* no-op */
        }
      }

      registerDisposal(ctx, function dispose() {
        if (disposed) return
        disposed = true
        if (retryTimer) {
          window.clearInterval(retryTimer)
          retryTimer = 0
        }
        if (unsubscribe) {
          try {
            unsubscribe()
          } catch (error) {
            /* no-op */
          }
          unsubscribe = null
        }
        destroyLayer()
      })
    }

    // --------------------------------------------------------------- exports

    var api = {
      name: NAME,
      version: VERSION,
      /** Manual trigger (also the preview page's entry point): `__dshConfetti.fire()`. */
      fire: function (options) {
        fire(options)
      },
      /** Drop the canvas and every live piece without unloading the plugin. */
      clear: function () {
        destroyLayer()
      },
    }

    try {
      window.__dshConfetti = api
    } catch (error) {
      /* a frozen window global is not worth failing activation over */
    }

    exports.name = NAME
    exports.inject = ['slots']
    exports.apply = apply
    exports.fire = api.fire

    return module.exports
  },
})
