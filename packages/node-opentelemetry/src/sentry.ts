import api, { Span, SpanKind } from '@opentelemetry/api';
import { ExceptionEventName } from '@opentelemetry/sdk-trace-base/build/src/enums';
import {
  SEMATTRS_EXCEPTION_MESSAGE,
  SEMATTRS_EXCEPTION_STACKTRACE,
  SEMATTRS_EXCEPTION_TYPE,
  SEMATTRS_HTTP_STATUS_CODE,
  SEMATTRS_HTTP_RESPONSE_CONTENT_LENGTH,
} from '@opentelemetry/semantic-conventions';
import { Event, EventHint, Exception, EventProcessor } from '@sentry/types';

import hdx from './debug';
import { jsonToString } from './utils';

const tracer = api.trace.getTracer('@hyperdx/node-opentelemetry');

// CUSTOM SEMANTIC CONVENTIONS
const SEMATTRS_EXCEPTION_MODULES = 'exception.modules';
const SEMATTRS_EXCEPTION_TAGS = 'exception.tags';

// https://github.com/open-telemetry/opentelemetry-js/blob/ca027b5eed282b4e81e098ca885db9ce27fdd562/packages/opentelemetry-sdk-trace-base/src/Span.ts#L299
const recordException = (span: Span, exception: Exception) => {
  span.addEvent(ExceptionEventName, {
    [SEMATTRS_EXCEPTION_MESSAGE]: exception.value,
    [SEMATTRS_EXCEPTION_STACKTRACE]: jsonToString(exception.stacktrace),
    [SEMATTRS_EXCEPTION_TYPE]: exception.type,
  });
};

const isSentryEventAnException = (event: Event) =>
  event.exception?.values?.length > 0;

// TODO: enrich span with more info
const buildSingleSpanName = (event: Event) =>
  [event.exception?.values[0].type, event.transaction].join(' ');

const startOtelSpanFromSentryEvent = (event: Event, hint: EventHint) => {
  // FIXME: can't attach to the active span
  // since Sentry would overwrite the active span
  // let span = api.trace.getActiveSpan();
  let span = null;
  let isRootSpan = false;
  const startTime = event.timestamp * 1000;
  const attributes = {
    ...(event.modules && {
      [SEMATTRS_EXCEPTION_MODULES]: jsonToString(event.modules),
    }),
    // TODO: decide what to do with tags
    [SEMATTRS_EXCEPTION_TAGS]: jsonToString({
      culture: event.contexts?.culture,
      environment: event.environment,
    }),
    ...(event.contexts?.app && {
      'app.build_type': event.contexts.app.build_type,
      'app.id': event.contexts.app.app_identifier,
      'app.memory': event.contexts.app.app_memory,
      'app.name': event.contexts.app.app_name,
      'app.start_time': event.contexts.app.app_start_time,
      'app.version': event.contexts.app.app_version,
    }),
    // https://opentelemetry.io/docs/specs/semconv/http/http-spans/
    ...(event.contexts?.response && {
      [SEMATTRS_HTTP_STATUS_CODE]: event.contexts.response.status_code,
      [SEMATTRS_HTTP_RESPONSE_CONTENT_LENGTH]:
        event.contexts.response.body_size,
      ...(event.contexts.response.headers &&
        Object.entries(event.contexts.response.headers).reduce(
          (acc, [key, value]) => {
            acc[`http.response.header.${key}`] = value;
            return acc;
          },
        ),
      {}),
    }),
    // https://opentelemetry.io/docs/specs/semconv/resource/cloud/
    ...(event.contexts?.cloud_resource && {
      'cloud.provider': event.contexts.cloud_resource['cloud.provider'],
      'cloud.account.id': event.contexts.cloud_resource['cloud.account.id'],
      'cloud.region': event.contexts.cloud_resource['cloud.region'],
      'cloud.availability_zone':
        event.contexts.cloud_resource['cloud.availability_zone'],
      'cloud.platform': event.contexts.cloud_resource['cloud.platform'],
      'host.id': event.contexts.cloud_resource['host.id'],
      'host.type': event.contexts.cloud_resource['host.type'],
    }),
    // https://opentelemetry.io/docs/specs/semconv/resource/os/
    ...(event.contexts?.os && {
      'os.build_id': event.contexts.os.build,
      'os.kernel_version': event.contexts.os.kernel_version,
      'os.type': event.contexts.os.name,
      'os.version': event.contexts.os.version,
    }),
    ...(event.contexts?.device && {
      // https://opentelemetry.io/docs/specs/semconv/resource/device/
      'device.id': event.contexts.device.device_unique_identifier,
      'device.manufacturer': event.contexts.device.manufacturer,
      'device.model.identifier': event.contexts.device.model_id,
      'device.model.name': event.contexts.device.model,
      // NOT FROM OTEL SPECS
      // TODO: do we want to separate device by type? ex: browser vs mobile
      'device.type': event.contexts.device.device_type,
      'device.battery_level': event.contexts.device.battery_level,
      'device.battery_status': event.contexts.device.battery_status,
      'device.orientation': event.contexts.device.orientation,
      'device.brand': event.contexts.device.brand,
      'device.sreen_resolution': event.contexts.device.screen_resolution,
      'device.screen_height_pixels': event.contexts.device.screen_height_pixels,
      'device.screen_width_pixels': event.contexts.device.screen_width_pixels,
      'device.screen_density': event.contexts.device.screen_density,
      'device.screen_dpi': event.contexts.device.screen_dpi,
      'device.online': event.contexts.device.online,
      'device.charging': event.contexts.device.charging,
      'device.supports_vibration': event.contexts.device.supports_vibration,
      'device.supports_accelerometer':
        event.contexts.device.supports_accelerometer,
      'device.supports_gyroscope': event.contexts.device.supports_gyroscope,
      'device.supports_audio': event.contexts.device.supports_audio,
      'device.supports_location_service':
        event.contexts.device.supports_location_service,
      'device.boot_time': event.contexts.device.boot_time,
      'device.low_memory': event.contexts.device.low_memory,
      'device.simulator': event.contexts.device.simulator,
      'device.memory_size': event.contexts.device.memory_size,
      'device.free_memory': event.contexts.device.free_memory,
      'device.usable_memory': event.contexts.device.usable_memory,
      'device.storage_size': event.contexts.device.storage_size,
      'device.free_storage': event.contexts.device.free_storage,
      'device.external_storage_size':
        event.contexts.device.external_storage_size,
      'device.external_free_storage':
        event.contexts.device.external_free_storage,
      // https://opentelemetry.io/docs/specs/semconv/resource/host/
      'host.cpu.model.name': event.contexts.device.cpu_description,
      'host.cpu.count': event.contexts.device.processor_count,
      'host.cpu.frequency': event.contexts.device.processor_frequency,
    }),
    // https://opentelemetry.io/docs/specs/semconv/resource/host/
    ...(event.server_name && {
      'host.name': event.server_name,
    }),
  };
  if (span == null) {
    isRootSpan = true;
    span = tracer.startSpan(buildSingleSpanName(event), {
      attributes,
      startTime,
      kind: SpanKind.INTERNAL,
    });
  }
  // record exceptions
  for (const exception of event.exception?.values ?? []) {
    recordException(span, exception);
  }

  if (isRootSpan) {
    span.end(startTime);
  }
};

const registerEventProcessor = (event: Event, hint: EventHint) => {
  try {
    hdx('Received event');
    if (isSentryEventAnException(event)) {
      startOtelSpanFromSentryEvent(event, hint);
    }
  } catch (e) {
    hdx(`Error processing event: ${e}`);
  }
  // WARNING: always return the event
  return event;
};

export const initSDK = async () => {
  try {
    const Sentry = await import('@sentry/node');
    hdx(`Detected Sentry installed with SDK version: ${Sentry.SDK_VERSION}`);
    const client = Sentry.getCurrentHub()?.getClient();
    if (!client) {
      hdx('Sentry client not found');
    }
    // TODO: initialize Sentry SDK ??

    let eventProcessor: (cb: EventProcessor) => void;
    // v8
    // @ts-ignore
    if (typeof Sentry.addEventProcessor === 'function') {
      hdx('Sentry.addEventProcessor is available');
      // @ts-ignore
      eventProcessor = Sentry.addEventProcessor;
    }
    // v7
    // @ts-ignore
    else if (typeof Sentry.addGlobalEventProcessor === 'function') {
      hdx('Sentry.addGlobalEventProcessor is available');
      // @ts-ignore
      eventProcessor = Sentry.addGlobalEventProcessor;
    } else {
      hdx('No Sentry api available to register event processor');
      return;
    }
    eventProcessor(registerEventProcessor);
    hdx('Registered Sentry event hooks');
  } catch (e) {
    hdx(`Error initializing Sentry SDK: ${e}`);
  }
};
