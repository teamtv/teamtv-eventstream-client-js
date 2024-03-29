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
  constructor(endpointUrl, interval)
  {
    this.endPointUrl = endpointUrl;
    this.interval = interval;
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
      let serverTime = (new Date(xmlHttp.getResponseHeader('date'))) / 1000;
      const age = xmlHttp.getResponseHeader('age');
      if (!!age) {
        serverTime += parseInt(age);
      }
      this._processEvents(events, serverTime);
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

  _processEvents(events, timestamp)
  {
    for(const event of events)
    {
      if (typeof this.eventHandlers[event.event_name] !== "undefined") {
        for(const eventHandler of this.eventHandlers[event.event_name]) {
          eventHandler({
            data: {
              eventAttributes: event.event_attributes,
              occurredOn: event.occurred_on,
              description: undefined
            },
            timestamp: timestamp
          });
        }
      }
      this.lastEventId = event.event_id;
    }
  }

  start() {
    this.fetch();
    this._interval = setInterval(() => this.fetch(), this.interval * 1000);
  }

  stop() {
    clearInterval(this._interval);
  }
}

class EventStream
{
  constructor(eventStreamSource, periodCount=2)
  {

    eventStreamSource.addEventListener("Shot", this._createEventHandler("shot"));
    eventStreamSource.addEventListener("Goal", this._createEventHandler("goal"));
    eventStreamSource.addEventListener("BallLoss", this._createEventHandler("ballLoss"));
    eventStreamSource.addEventListener("Substitution", this._createEventHandler("substitution"));
    eventStreamSource.addEventListener("GoalCorrection", this._createEventHandler("goalCorrection"));
    eventStreamSource.addEventListener("PenaltyGiven", this._createEventHandler("penaltyGiven"));

    eventStreamSource.addEventListener("StartPossession", this._wrapEventHandler(this._onStartPossession.bind(this)));

    eventStreamSource.addEventListener("SportingEventCreated", this._wrapEventHandler(this.onSportingEventCreated.bind(this)));
    eventStreamSource.addEventListener("EndPeriod", this._wrapEventHandler(this.onEndPeriod.bind(this)));
    eventStreamSource.addEventListener("StartPeriod", this._wrapEventHandler(this.onStartPeriod.bind(this)));

    eventStreamSource.addEventListener("ObservationRemoved", this._wrapEventHandler(this.onObservationRemoved.bind(this)));


    this._possessionStates = [];

    this.currentState = {
      possession: null,
      period: null
    };

    this._eventHandlers = {};

    this.on('endPeriod', ({period}) => {
      if (parseInt(period) === periodCount) {
        eventStreamSource.stop();
      }
    });
  }

  _updatePossession()
  {
    if (this._possessionStates.length === 0) {
      this.currentState.possession = null;
    } else {
      this.currentState.possession = this._possessionStates[this._possessionStates.length - 1].state;
    }
  }

  pushPossessionState(id, state)
  {
    this._possessionStates.push({id, state});
    this._updatePossession();
  }

  _popPossiblePossessionState(id)
  {
    if (this._possessionStates.length === 0) {
      return;
    }

    if (this._possessionStates[this._possessionStates.length - 1].id === id) {
      this._possessionStates.pop();
      this._updatePossession();
    }
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

  _trigger(eventName, attributes, timestamp)
  {
    if (typeof this._eventHandlers[eventName] !== "undefined")
    {
      for(const callback of this._eventHandlers[eventName])
      {
        callback(attributes, timestamp);
      }
    }
  }

  _wrapEventHandler(fn)
  {
    return ({data, timestamp}) => {
      const {eventAttributes, description, occurredOn} = typeof data === "string" ? JSON.parse(data) : data;
      fn(eventAttributes, description, occurredOn, timestamp);
    };
  }

  _createEventHandler(eventName)
  {
    return this._wrapEventHandler(
      ({id, time, [`${eventName}Attributes`]: attributes, description}, description_, occurredOn, timestamp) => {
        this._trigger(
          eventName,
          {
            time: this.relativeTime(time),
            id, description,
            ...attributes,
            possession: this.currentState.possession
          },
          timestamp
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

  _onStartPossession({id, time, startPossessionAttributes: attributes}, description, occurredOn, timestamp)
  {
    this._endPossession(time);

    this.pushPossessionState(id, {
      startTime: this.relativeTime(time),
      id,
      ...attributes
    });

    this._trigger(
      "startPossession",
      this.currentState.possession,
        timestamp
    );
  }

  onEndPeriod({clockId, time, period}, description, occurredOn, timestamp)
  {
    this._endPossession();

    this._trigger(
      "endPeriod",
      {
        period,
        occurredOn
      },
        timestamp
    )
  }

  onStartPeriod({clockId, time, period}, description, occurredOn, timestamp)
  {
    this.currentState.period = {
      time: time,
      period,
      occurredOn
    };

    this._trigger(
      "startPeriod",
      {
        period,
        occurredOn
      },
        timestamp
    )
  }

  onSportingEventCreated({name, homeTeam, awayTeam, scheduledAt}, description, occurredOn, timestamp)
  {
    this._trigger(
      "sportingEventCreated",
      {
        name,
        homeTeam, awayTeam,
        scheduledAt
      },
        timestamp
    )
  }

  onObservationRemoved({id}, description, occurredOn, timestamp) {
    this._popPossiblePossessionState(id);

    this._trigger(
      "observationRemoved",
      {
        id
      },
        timestamp
    );
  }
}

export { SSEEventStreamSource, PollingEventStreamSource, EventStream };