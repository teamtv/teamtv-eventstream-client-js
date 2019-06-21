class SSEEventStreamSource
{
  constructor(endpointUrl)
  {
    this.eventSource = new EventSource(endpointUrl);
  }

  addEventListener(eventName, handler)
  {
    this.eventSource.addEventListener(eventName, handler);
  }

  stop() {
    this.eventSource.close();
  }
}

class PollingEventStreamSource
{
  constructor(endpointUrl)
  {
    this.endPointUrl = endpointUrl;
    this.lastEventId = null;
    this.eventHandlers = {};
    this.start();
  }

  fetch() {
    let url = this.endPointUrl;
    if (this.lastEventId !== null) {
      url += "?last-event-id=" + this.lastEventId;
    }
    const xmlHttp = new XMLHttpRequest();

    xmlHttp.onload = () => {
      const events = JSON.parse(xmlHttp.responseText);
      this._processEvents(events);
    };

    xmlHttp.open( "GET", url, true );
    xmlHttp.send();
  }

  addEventListener(eventName, handler)
  {
    if (typeof this.eventHandlers[eventName] === "undefined") {
      this.eventHandlers[eventName] = [];
    }
    this.eventHandlers[eventName].push(handler);
  }

  _processEvents(events)
  {
    for(const event of events)
    {
      if (typeof this.eventHandlers[event.event_name] !== "undefined") {
        for(const eventHandler of this.eventHandlers[event.event_name]) {
          eventHandler({
            data: {
              eventAttributes: event.event_attributes,
              occurredOn: event.occured_on,
              description: undefined
            }
          });
        }
      }
      this.lastEventId = event.event_id;
    }
  }

  start() {
    this.fetch();
    this._interval = setInterval(() => this.fetch(), 5000);
  }

  stop() {
    clearInterval(this._interval);
  }
}

class EventStream
{
  constructor(eventStreamSource)
  {

    eventStreamSource.addEventListener("Shot", this._createEventHandler("shot"));
    eventStreamSource.addEventListener("BallLoss", this._createEventHandler("ballLoss"));
    eventStreamSource.addEventListener("Substitution", this._createEventHandler("substitution"));
    eventStreamSource.addEventListener("GoalCorrection", this._createEventHandler("goalCorrection"));
    eventStreamSource.addEventListener("PenaltyGiven", this._createEventHandler("penaltyGiven"));

    eventStreamSource.addEventListener("StartPossession", this._wrapEventHandler(this._onStartPossession.bind(this)));
    eventStreamSource.addEventListener("EndPeriod", this._wrapEventHandler(this.onEndPeriod.bind(this)));
    eventStreamSource.addEventListener("StartPeriod", this._wrapEventHandler(this.onStartPeriod.bind(this)));


    this.currentState = {
      possession: null,
      period: null
    };

    this._eventHandlers = {};

    this.on('endPeriod', ({period}) => {
      if (parseInt(period) === 2) {
        eventStreamSource.stop();
      }
    });
  }

  relativeTime(time)
  {
    return {
      time: time - this.currentState.period.time,
      period: this.currentState.period.period
    }
  }

  on(eventName, callback)
  {
    if (typeof this._eventHandlers[eventName] === "undefined")
    {
      this._eventHandlers[eventName] = [];
    }
    this._eventHandlers[eventName].push(callback);
  }

  _trigger(eventName, attributes)
  {
    if (typeof this._eventHandlers[eventName] !== "undefined")
    {
      for(const callback of this._eventHandlers[eventName])
      {
        callback(attributes);
      }
    }
  }

  _wrapEventHandler(fn)
  {
    return ({data}) => {
      const {eventAttributes, description, occurredOn} = typeof data === "string" ? JSON.parse(data) : data;
      fn(eventAttributes, description, occurredOn);
    };
  }

  _createEventHandler(eventName)
  {
    return this._wrapEventHandler(
      ({id, time, [`${eventName}Attributes`]: attributes, description}) => {
        this._trigger(
          eventName,
          {
            time: this.relativeTime(time),
            id, description,
            ...attributes,
            possession: this.currentState.possession
          }
        );
      }
    );
  }

  _endPossession(nextPossessionStartTime)
  {
    if (this.currentState.possession !== null)
    {
      this._trigger(
        "endPossession",
        {
          endTime: this.relativeTime(nextPossessionStartTime - 0.0001),
          ...this.currentState.possession
        }
      )
    }
  }

  _onStartPossession({id, time, startPossessionAttributes: attributes})
  {
    this._endPossession(time);

    this.currentState.possession = {
      startTime: this.relativeTime(time),
      id,
      ...attributes
    };

    this._trigger(
      "startPossession",
      this.currentState.possession
    );
  }

  onEndPeriod({clockId, time, period})
  {
    this._endPossession();

    this._trigger(
      "endPeriod",
      {
        period
      }
    )
  }

  onStartPeriod({clockId, time, period})
  {
    this.currentState.period = {
      time: time,
      period
    };

    this._trigger(
      "startPeriod",
      {
        period
      }
    )
  }
}

export { SSEEventStreamSource, PollingEventStreamSource, EventStream };