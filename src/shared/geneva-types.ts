// Geneva/Jarvis Dashboard API Types

/** Individual MQL query configuration within a widget */
export interface GenevaMqlQuery {
  account: string;
  namespace: string;
  kqlQuery: string;
  displayOptions?: {
    color?: string;
    lineStyle?: string;
    units?: string;
    [key: string]: unknown;
  };
}

/** Widget view/display options */
export interface GenevaWidgetView {
  chartType?: string;
  thresholds?: unknown[];
  legend?: unknown;
  [key: string]: unknown;
}

/** Widget data configuration */
export interface GenevaWidgetData {
  startTime: number;
  endTime: number;
  mdmKql?: GenevaMqlQuery[];
  [key: string]: unknown;
}

/** A single widget within a dashboard */
export interface GenevaWidget {
  guid: string;
  wires: {
    title: string;
    data: GenevaWidgetData;
    view?: GenevaWidgetView;
    drilldown?: unknown;
  };
}

/** Full dashboard definition returned by the get endpoint */
export interface GenevaDashboard {
  account: string;
  id: string;
  path: string;
  content: {
    wires: {
      widgets: GenevaWidget[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

/** POST body for the queryGateway metrics endpoint */
export interface GenevaMetricsRequest {
  monitoringAccount: string;
  metricNamespace: string;
  startTimeUTC: string;
  endTimeUTC: string;
  queryStatement: string;
  resolutionInMilliseconds?: number;
  resolutionReductionAggregationType?: string;
  selectionCount?: number;
  queryParameters?: Record<string, string>;
}

/** A single dimension key-value pair */
export interface GenevaDimension {
  key: string;
  value: string;
}

/** A single time series value set (sampling type + values) */
export interface GenevaTimeSeriesValue {
  key: string;
  value: (number | string)[];
}

/** A single time series with dimensions and values */
export interface GenevaTimeSeries {
  dimensionList: GenevaDimension[];
  timeSeriesValues: GenevaTimeSeriesValue[];
}

/** A message from the metrics query response */
export interface GenevaQueryMessage {
  messageID: string;
  severity: number;
  text: string;
}

/** Response from the queryGateway metrics endpoint */
export interface GenevaMetricsResponse {
  timeResolutionInMilliseconds: number;
  startTimeUtc: string;
  endTimeUtc: string;
  outputDimensions: string[];
  outputSamplingTypes: string[];
  timeSeriesList: GenevaTimeSeries[];
  messages?: GenevaQueryMessage[];
}

/** Entry in the dashboard tree listing */
export interface GenevaDashboardTreeEntry {
  account: string;
  path: string;
  lastUpdatedBy?: string;
  lastUpdated?: string;
  isDeleted?: boolean;
}

/** Result for a single widget's metrics query */
export interface GenevaWidgetMetrics {
  widgetTitle: string;
  widgetGuid: string;
  query: GenevaMqlQuery;
  results: GenevaMetricsResponse;
}

/** Combined result: dashboard definition + all widget metrics */
export interface GenevaDashboardMetrics {
  dashboard: GenevaDashboard;
  widgetMetrics: GenevaWidgetMetrics[];
}

/** Cached tokens from gather-geneva-secrets.py */
export interface GenevaTokens {
  cookie: string;
  csrf: string;
}
