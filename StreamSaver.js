/*
 * Copyright (c) 2016-2020 Jimmy Karl Roland Wärting
 * Copyright (c) 2019 Yahweasel
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

/* Yahweasel's only changes to this file are to make it more portable */

/* global chrome location ReadableStream define MessageChannel TransformStream */

;(function(name, definition) {
  typeof module !== 'undefined'
    ? module.exports = definition()
    : typeof define === 'function' && typeof define.amd === 'object'
      ? define(definition)
      : this[name] = definition()
})('streamSaver', function() {
  'use strict'

  var mitmTransporter = null
  var supportsTransferable = false
  var test = function(fn) { try { fn() } catch (e) {} }
  var ponyfill = window.WebStreamsPolyfill || {}
  var isSecureContext = window.isSecureContext
  // TODO: Must come up with a real detection test (#69)
  var useBlobFallback = /constructor/i.test(window.HTMLElement) || !!window.safari || !!window.WebKitPoint
  var downloadStrategy = isSecureContext || 'MozAppearance' in document.documentElement.style
    ? 'iframe'
    : 'navigate'

  var streamSaver = {
    createWriteStream: createWriteStream,
    WritableStream: window.WritableStream || ponyfill.WritableStream,
    supported: true,
    version: { full: '2.0.0', major: 2, minor: 0, dot: 0 },
    mitm: 'https://jimmywarting.github.io/StreamSaver.js/mitm.html?version=2.0.0'
  }

  /**
   * create a hidden iframe and append it to the DOM (body)
   *
   * @param  {string} src page to load
   * @return {HTMLIFrameElement} page to load
   */
  function makeIframe (src) {
    if (!src) throw new Error('meh')
    var iframe = document.createElement('iframe')
    iframe.hidden = true
    iframe.src = src
    iframe.loaded = false
    iframe.name = 'iframe'
    iframe.isIframe = true
    iframe.postMessage = function() { return iframe.contentWindow.postMessage.apply(iframe.contentWindow, arguments); }
    iframe.addEventListener('load', function() {
      iframe.loaded = true
    }, { once: true })
    document.body.appendChild(iframe)
    return iframe
  }

  /**
   * create a popup that simulates the basic things
   * of what a iframe can do
   *
   * @param  {string} src page to load
   * @return {object}     iframe like object
   */
  function makePopup (src) {
    var options = 'width=200,height=100'
    var delegate = document.createDocumentFragment()
    var popup = {
      frame: window.open(src, 'popup', options),
      loaded: false,
      isIframe: false,
      isPopup: true,
      remove () { popup.frame.close() },
      addEventListener: function() { delegate.addEventListener.apply(delegate, arguments) },
      dispatchEvent: function() { delegate.dispatchEvent.apply(delegate, arguments) },
      removeEventListener: function() { delegate.removeEventListener.apply(delegate, arguments) },
      postMessage: function() { popup.frame.postMessage.apply(popup.frame, arguments) }
    }

    var onReady = function(evt) {
      if (evt.source === popup.frame) {
        popup.loaded = true
        window.removeEventListener('message', onReady)
        popup.dispatchEvent(new Event('load'))
      }
    }

    window.addEventListener('message', onReady)

    return popup
  }

  try {
    // We can't look for service worker since it may still work on http
    new Response(new ReadableStream())
    if (isSecureContext && !('serviceWorker' in navigator)) {
      useBlobFallback = true
    }
  } catch (err) {
    useBlobFallback = true
  }

  test(function() {
    // Transfariable stream was first enabled in chrome v73 behind a flag
    var readable = new TransformStream().readable
    var mc = new MessageChannel()
    mc.port1.postMessage(readable, [readable])
    mc.port1.close()
    mc.port2.close()
    supportsTransferable = true
    // Freeze TransformStream object (can only work with native)
    Object.defineProperty(streamSaver, 'TransformStream', {
      configurable: false,
      writable: false,
      value: TransformStream
    })
  })

  function loadTransporter () {
    if (!mitmTransporter) {
      mitmTransporter = isSecureContext
        ? makeIframe(streamSaver.mitm)
        : makePopup(streamSaver.mitm)
    }
  }

  /**
   * @param  {string} filename filename that should be used
   * @param  {object} options  [description]
   * @param  {number} size     depricated
   * @return {WritableStream}
   */
  function createWriteStream (filename, options, size) {
    var opts = {
      size: null,
      pathname: null,
      writableStrategy: undefined,
      readableStrategy: undefined
    }

    var bytesWritten = 0 // by StreamSaver.js (not the service worker)
    var downloadUrl = null
    var channel = null
    var ts = null

    // normalize arguments
    if (Number.isFinite(options)) {
      var tmp = size;
      size = options;
      options = tmp;
      console.warn('[StreamSaver] Depricated pass an object as 2nd argument when creating a write stream')
      opts.size = size
      opts.writableStrategy = options
    } else if (options && options.highWaterMark) {
      console.warn('[StreamSaver] Depricated pass an object as 2nd argument when creating a write stream')
      opts.size = size
      opts.writableStrategy = options
    } else {
      opts = options || {}
    }
    if (!useBlobFallback) {
      loadTransporter()

      channel = new MessageChannel()
      
      // Make filename RFC5987 compatible
      filename = encodeURIComponent(filename.replace(/\//g, ':'))
        .replace(/['()]/g, escape)
        .replace(/\*/g, '%2A')

      var response = {
        transferringReadable: supportsTransferable,
        pathname: opts.pathname || Math.random().toString().slice(-6) + '/' + filename,
        headers: {
          'Content-Type': 'application/octet-stream; charset=utf-8',
          'Content-Disposition': "attachment; filename*=UTF-8''" + filename
        }
      }

      if (opts.size) {
        response.headers['Content-Length'] = opts.size
      }

      var args = [ response, '*', [ channel.port2 ] ]

      if (supportsTransferable) {
        var transformer = downloadStrategy === 'iframe' ? undefined : {
          // This transformer & flush method is only used by insecure context.
          transform (chunk, controller) {
            bytesWritten += chunk.length
            controller.enqueue(chunk)

            if (downloadUrl) {
              location.href = downloadUrl
              downloadUrl = null
            }
          },
          flush () {
            if (downloadUrl) {
              location.href = downloadUrl
            }
          }
        }
        ts = new streamSaver.TransformStream(
          transformer,
          opts.writableStrategy,
          opts.readableStrategy
        )
        var readableStream = ts.readable

        channel.port1.postMessage({ readableStream: readableStream }, [ readableStream ])
      }

      channel.port1.onmessage = function(evt) {
        // Service worker sent us a link that we should open.
        if (evt.data.download) {
          // Special treatment for popup...
          if (downloadStrategy === 'navigate') {
            mitmTransporter.remove()
            mitmTransporter = null
            if (bytesWritten) {
              location.href = evt.data.download
            } else {
              downloadUrl = evt.data.download
            }
          } else {
            if (mitmTransporter.isPopup) {
              mitmTransporter.remove()
              mitmTransporter = null
              // Special case for firefox, they can keep sw alive with fetch
              if (downloadStrategy === 'iframe') {
                makeIframe(streamSaver.mitm)
              }
            }

            // We never remove this iframes b/c it can interrupt saving
            if (navigator.userAgent.indexOf("Firefox") >= 0)
              makePopup(evt.data.download)
            else
              makeIframe(evt.data.download)
          }
        }
      }

      if (mitmTransporter.loaded) {
        mitmTransporter.postMessage.apply(mitmTransporter, args)
      } else {
        mitmTransporter.addEventListener('load', function() {
          mitmTransporter.postMessage.apply(mitmTransporter, args)
        }, { once: true })
      }
    }

    var chunks = []

    return (!useBlobFallback && ts && ts.writable) || new streamSaver.WritableStream({
      write (chunk) {
        if (useBlobFallback) {
          // Safari... The new IE6
          // https://github.com/jimmywarting/StreamSaver.js/issues/69
          //
          // even doe it has everything it fails to download anything
          // that comes from the service worker..!
          chunks.push(chunk)
          return
        }

        // is called when a new chunk of data is ready to be written
        // to the underlying sink. It can return a promise to signal
        // success or failure of the write operation. The stream
        // implementation guarantees that this method will be called
        // only after previous writes have succeeded, and never after
        // close or abort is called.

        // TODO: Kind of important that service worker respond back when
        // it has been written. Otherwise we can't handle backpressure
        // EDIT: Transfarable streams solvs this...
        channel.port1.postMessage(chunk)
        bytesWritten += chunk.length

        if (downloadUrl) {
          location.href = downloadUrl
          downloadUrl = null
        }
      },
      close () {
        if (useBlobFallback) {
          var blob = new Blob(chunks, { type: 'application/octet-stream; charset=utf-8' })
          var link = document.createElement('a')
          link.href = URL.createObjectURL(blob)
          link.download = filename
          link.click()
        } else {
          channel.port1.postMessage('end')
        }
      },
      abort () {
        chunks = []
        channel.port1.postMessage('abort')
        channel.port1.onmessage = null
        channel.port1.close()
        channel.port2.close()
        channel = null
      }
    }, opts.writableStrategy)
  }

  return streamSaver
})
