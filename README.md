# EventStream Client

_Simple Client for the teamtv event stream API_

## Installation

```bash
npm install --save @teamtv/eventstream-client
```

## Usage

```js
import { EventStream, SSEEventStreamSource } from '@teamtv/eventstream-client';

const es = new EventStream(
  new SSEEventStreamSource("<teamtv eventstream endpoint>")
);

es.on("shot", (attributes) => {
  if (attributes.result === "GOAL") {
    console.log("Shot", attributes);
  }
});
```
