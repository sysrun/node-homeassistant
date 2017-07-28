const EventEmitter = require('events')
const Websocket = require('ws')

const defaultConfig = {
  host: 'localhost',
  retryTimeout: 5000,
  timeout: 5000,
  retryCount: 10,
  port: 8123,
  password: ''
}

class Homeassistant extends EventEmitter {
  constructor(options) {
    super()

    this.config = Object.assign(defaultConfig, options)

    this.url = `ws://${this.config.host}:${this.config.port}/api/websocket`
    this.retriesLeft = this.config.retryCount
    this.promises = {}
    this.states = []
    this.id = 1
  }

  connect() {
    this.ws = new Websocket(this.url)

    this.ws.on('message', data => {
      data = JSON.parse(data)

      let p = this.promises[data.id]

      if (!p) return false;

      if (p.timeout) {
        clearTimeout(p.timeout)
      }

      if (p.callback) {
        p.callback(data)
      }
    })

    this.ws.on('error',  () => {
      this.reconnect()
    })

    this.ws.on('close', () => {
      this.reconnect()
    })

    return new Promise((resolve, reject) => {
      this.ws.on('open', () => {
        if(this.retry) {
          clearTimeout(this.retry)
          this.retry = null
        }

        this.retriesLeft = this.config.retryCount
        resolve(this)
      }) 
    }).then(() => {
      return this.send({
        type: 'get_states'
      })
    }).then(states => {
      this.states = states.result

      return this.subscribe({
        callback: this.updateState.bind(this)
      })
    })
  }

  reconnect() {
    if (this.retry) return true

    this.retry = setInterval(() => {
      if(this.retriesLeft === 0) {
        clearTimeout(this.retry)
        throw new Error('home-assistant connection closed')
      }

      if(this.retriesLeft > 0) this.retriesLeft--

      try {
        this.connect()
      } catch (error) {
        console.log('Reconnecting failed')
      }
    }, this.config.retryTimeout)
  }

  send(data) {
    data.id = this.id
    this.id++

    return new Promise((resolve, reject) => {
      this.promises[data.id] = {
        timeout: setTimeout(() => {
          return reject(new Error('No response received from home-assistant'))
        }, this.config.timeout),
        callback: resolve
      }
      this.ws.send(JSON.stringify(data))
    })
  }

  call(options) {
    return this.send(Object.assign({type: 'call_service'}, options))
  }

  subscribe(options) {
    if(!options.callback) throw new Error('Callback function is required')

    let data = { type: 'subscribe_events' }

    if(options.event) data.event_type = event

    return this.send(data)
      .then((data) => {
        if(!data.success) return Promise.reject(new Error(data))

        this.promises[data.id].callback = options.callback
        return Promise.resolve(data)
      })
  }

  unsubscribe(subscription) {
    return this.send({
      type: 'unsubscribe_events',
      subscription
    })
  }

  findEntity(id) {
    return this.states.findIndex(state => state.entity_id === id)
  }

  updateState(change) {
    let data = change.event.data
    if (change.event.event_type !== 'state_changed') return true

    let changeIndex = this.findEntity(data.entity_id)

    this.states[changeIndex] = data.new_state
    this.emit(`state:${data.entity_id}`, data)
  }

  state(entity) {
    return this.states[this.findEntity(entity)]
  }
}

module.exports = Homeassistant
