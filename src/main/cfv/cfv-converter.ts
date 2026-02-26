import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encode } from '@toon-format/toon';
import { ScrubLayer } from '../dgrep/scrub-layer.js';

// ============================================================================
// Call Flow Conversion
// ============================================================================

export async function convertCallFlow(data: Record<string, unknown>, outputDir: string): Promise<number> {
  const callflowDir = join(outputDir, 'callflow');
  const messagesDir = join(callflowDir, 'messages');
  await mkdir(messagesDir, { recursive: true });

  const scrubLayer = ScrubLayer.createDefault();

  const nrt = (data.nrtStreamingIndexAugmentedCall ?? {}) as Record<string, unknown>;
  const fullFlow = (nrt.fullCallFlow ?? {}) as Record<string, unknown>;
  const messages = (fullFlow.messages ?? []) as Array<Record<string, unknown>>;

  if (messages.length === 0) return 0;

  const csvLines = ['seq,timestamp,from,to,status,latency,fail,label'];

  const writePromises: Promise<void>[] = [];

  for (const msg of messages) {
    const seq = (msg.index as number) ?? 0;

    // Extract HTTP status from response string
    const resp = (msg.resp as string) ?? '';
    let httpStatus = '';
    if (resp && resp.includes('HTTP/')) {
      const firstLine = resp.split('\r\n')[0];
      const parts = firstLine.split(' ');
      if (parts.length >= 2) {
        httpStatus = parts[1];
      }
    }

    const timestamp = ((msg.reqTime as string) ?? '').slice(0, 19);
    const fromSvc = ((msg.from as string) ?? '').replaceAll(',', ';');
    const toSvc = ((msg.to as string) ?? '').replaceAll(',', ';');
    const status = httpStatus || String(msg.status ?? '');
    const latency = ((msg.latency as string) ?? '').replaceAll(',', ';');
    const isFailure = msg.isFailure ? 'Y' : '';
    const label = ((msg.label as string) ?? '').replaceAll(',', ';').replaceAll('"', "'");

    csvLines.push(`${seq},${timestamp},${fromSvc},${toSvc},${status},${latency},${isFailure},"${label}"`);

    const messageDetail = {
      seq,
      messageId: msg.messageId ?? '',
      timestamp: {
        request: msg.reqTime ?? '',
        response: msg.respTime ?? '',
        relative: msg.time ?? '',
      },
      routing: {
        from: msg.from ?? '',
        to: msg.to ?? '',
        protocol: msg.protocol ?? '',
      },
      request: {
        title: msg.reqTitle ?? '',
        label: msg.label ?? '',
        raw: msg.req ?? '',
      },
      response: {
        httpStatus,
        latency: msg.latency ?? '',
        raw: msg.resp ?? '',
      },
      outcome: {
        isFailure: (msg.isFailure as boolean) ?? false,
        hasError: (msg.hasError as boolean) ?? false,
        error: msg.error ?? '',
      },
      metadata: {
        callId: msg.callId ?? '',
        ltid: msg.ltid ?? '',
        randId: msg.randId ?? 0,
        kind: msg.kind ?? 0,
        associatedCallLegs: msg.associatedCallLegs ?? [],
        associatedParticipantIds: msg.associatedParticipantIds ?? [],
      },
    };

    const msgFilename = `${String(seq).padStart(4, '0')}.toon`;
    const scrubbedDetail = JSON.parse(scrubLayer.scrubText(JSON.stringify(messageDetail)));
    writePromises.push(
      writeFile(join(messagesDir, msgFilename), encode(scrubbedDetail), 'utf-8')
    );
  }

  // Write CSV index
  writePromises.push(
    writeFile(join(callflowDir, 'index.csv'), scrubLayer.scrubText(csvLines.join('\n')), 'utf-8')
  );

  // Write README
  const callInfo = (data.callInfo ?? {}) as Record<string, unknown>;
  const deployments = (callInfo.deployments ?? {}) as Record<string, Record<string, unknown>>;
  const ccTenant = (deployments.cc ?? {}).ownerTenant ?? 'N/A';
  const convTenant = (deployments.conv ?? {}).ownerTenant ?? 'N/A';

  const readme = `CFV Call Flow Index
===================
Call ID: ${data.callId ?? ''}
Total Messages: ${messages.length}

Deployments:
- CC: ${ccTenant}
- Conv: ${convTenant}

Usage:
1. Read index.csv to scan the call flow (seq, timestamp, from, to, status, latency, label)
2. To see full request/response for a message, read messages/<seq>.toon
   Example: For seq 42, read messages/0042.toon

Column Descriptions:
- seq: Sequence number (use to look up message file)
- timestamp: Request time (ISO 8601, trimmed)
- from: Source service
- to: Destination service
- status: HTTP status code (200, 201, 404, 500, etc.)
- latency: Response time
- fail: Y if failed, blank if success
- label: Human-readable operation description
`;

  writePromises.push(
    writeFile(join(callflowDir, 'README.txt'), scrubLayer.scrubText(readme), 'utf-8')
  );

  await Promise.all(writePromises);
  scrubLayer.save(callflowDir);
  return messages.length;
}

// ============================================================================
// Call Details Conversion
// ============================================================================

export async function convertCallDetails(data: Record<string, unknown>, outputDir: string): Promise<number> {
  const diagDir = join(outputDir, 'diagnostics');
  await mkdir(diagDir, { recursive: true });

  const scrubLayer = ScrubLayer.createDefault();

  const details = (data.callDetails ?? {}) as Record<string, unknown>;
  if (!details || Object.keys(details).length === 0) return 0;

  const writePromises: Promise<void>[] = [];

  // 1. Summary
  const summary = {
    callId: details.id ?? '',
    isNgInvolved: details.isNgInvolved ?? false,
    isNgMultiparty: details.isNgMultiparty ?? false,
    nerFailureReason: details.nerFailureReason ?? '',
    asrFailureReason: details.asrFailureReason ?? '',
    queryStatus: {
      finished: data.finished ?? false,
      failed: data.failed ?? false,
      error: data.error ?? '',
    },
    _usage: {
      description: 'High-level call summary. See other .toon files for detailed diagnostics.',
      format: 'TOON (Token-Oriented Object Notation) - 40% fewer tokens than JSON',
      files: {
        'legs.toon': 'Call leg information and outcomes',
        'qoe.toon': 'Quality of Experience metrics (network, device)',
        'network.toon': 'Network diagnostics and connectivity',
        'timeline.toon': 'Event timeline for call progression',
        'participants.toon': 'Participant and endpoint details',
      },
    },
  };
  const scrubbedSummary = JSON.parse(scrubLayer.scrubText(JSON.stringify(summary)));
  writePromises.push(writeFile(join(diagDir, 'summary.toon'), encode(scrubbedSummary), 'utf-8'));

  // 2. Legs
  const legs = (details.legs ?? []) as Array<Record<string, unknown>>;
  const legsData = {
    totalLegs: legs.length,
    legs: legs.map((leg) => {
      const backend = (leg.backendParticipant ?? {}) as Record<string, unknown>;
      const hasBackend = Object.keys(backend).length > 0;
      return {
        legId: leg.legId ?? '',
        legType: leg.legType ?? '',
        userType: leg.userType ?? '',
        role: leg.role ?? '',
        isNGInvolved: leg.isNGInvolved ?? false,
        failedStep: leg.failedStep ?? null,
        participant: hasBackend ? {
          participantId: backend.participantId ?? '',
          role: backend.role ?? '',
          userType: backend.userType ?? '',
        } : {},
        outcome: hasBackend ? {
          resultCode: backend.resultCode ?? '',
          resultSubCode: backend.resultSubCode ?? '',
          resultDetail: backend.resultDetail ?? '',
          resultDetailString: backend.resultDetailString ?? '',
          callEndMessage: backend.callEndMessage ?? '',
          didAccept: backend.didAccept ?? false,
          didInitiateCallEnd: backend.didInitiateCallEnd ?? false,
        } : {},
        timestamps: hasBackend ? (backend.timestamps ?? []) : [],
        uiVersion: leg.uiVersion ?? {},
      };
    }),
  };
  const scrubbedLegs = JSON.parse(scrubLayer.scrubText(JSON.stringify(legsData)));
  writePromises.push(writeFile(join(diagDir, 'legs.toon'), encode(scrubbedLegs), 'utf-8'));

  // 3. QoE
  const qoeRaw = (details.qoe ?? []) as Array<Record<string, unknown>>;
  const qoeFields: Record<string, string[]> = {
    network: [
      'mediaLine_OutboundStream_Network_Delay_RoundTrip',
      'mediaLine_OutboundStream_Network_Delay_RoundTripMax',
      'mediaLine_OutboundStream_Network_PacketLoss_LossRate',
      'mediaLine_OutboundStream_Network_PacketLoss_LossRateMax',
      'mediaLine_OutboundStream_Network_Jitter_InterArrival',
      'mediaLine_InboundStream_Network_PacketLoss_LossRate',
      'mediaLine_InboundStream_Network_Jitter_InterArrival',
    ],
    device: [
      'mediaLine_v2_LocalClientEvent_v2_CPUInsufficientEventRatio',
      'mediaLine_v2_LocalClientEvent_v2_NetworkReceiveQualityEventRatio',
      'mediaLine_v2_LocalClientEvent_v2_NetworkSendQualityEventRatio',
      'mediaLine_v2_LocalClientEvent_v2_DeviceEchoEventRatio',
      'mediaLine_v2_LocalClientEvent_v2_DeviceClippingEventRatio',
    ],
    connectivity: [
      'connectivity_FirstHopRTTInMs',
      'connectivity_MediaPathLocal',
      'connectivity_MediaPathRemote',
      'connectivity_Protocol',
      'connectivity_TotalBytesSent',
      'connectivity_TotalBytesReceived',
    ],
    endpoint: [
      'endpoint_v2_OS',
      'endpoint_v2_CPUName',
      'endpoint_v2_CPUNumberOfCores',
      'endpoint_v7_DeviceFormFactor',
      'endpoint_v7_MachineInfo',
    ],
  };

  const qoeData = {
    totalEntries: qoeRaw.length,
    entries: qoeRaw.map((qoeEntry) => {
      const extracted: Record<string, unknown> = { _raw_field_count: Object.keys(qoeEntry).length };
      for (const [category, fields] of Object.entries(qoeFields)) {
        const categoryData: Record<string, unknown> = {};
        for (const field of fields) {
          if (field in qoeEntry) {
            const shortKey = field.includes('_') ? field.split('_').pop()! : field;
            categoryData[shortKey] = qoeEntry[field];
          }
        }
        extracted[category] = categoryData;
      }
      return extracted;
    }),
  };
  const scrubbedQoe = JSON.parse(scrubLayer.scrubText(JSON.stringify(qoeData)));
  writePromises.push(writeFile(join(diagDir, 'qoe.toon'), encode(scrubbedQoe), 'utf-8'));

  // 4. Network (mdiag)
  const mdiagRaw = (details.mdiag ?? []) as Array<Record<string, unknown>>;
  const networkFields = [
    'connectivity_AllocationTimeInMs', 'connectivity_FinalAnsRcvMs',
    'connectivity_FirstPathMs', 'connectivity_IceConnCheckStatus',
    'connectivity_IceOptimizationMode', 'connectivity_ReconnectEnabled',
    'connectivity_MTurnRtpSessionID', 'media_NetworkErr', 'media_MediaTimeout',
    'mediaAllocationFailures', 'mediaAllocations', 'connectivityCheckFailed',
    'reason', 'isRetargeted', 'reconnectAttemptedCount', 'reconnectConnectedCount',
  ];

  const networkData = {
    totalEntries: mdiagRaw.length,
    entries: mdiagRaw
      .map((entry) => {
        const extracted: Record<string, unknown> = {};
        for (const field of networkFields) {
          if (field in entry) {
            extracted[field] = entry[field];
          }
        }
        return extracted;
      })
      .filter((entry) => Object.keys(entry).length > 0),
  };
  const scrubbedNetwork = JSON.parse(scrubLayer.scrubText(JSON.stringify(networkData)));
  writePromises.push(writeFile(join(diagDir, 'network.toon'), encode(scrubbedNetwork), 'utf-8'));

  // 5. Timeline (csamod)
  const csamodRaw = (details.csamod ?? []) as Array<Record<string, unknown>>;
  const timelineData = {
    totalEntries: csamodRaw.length,
    entries: csamodRaw.map((csaEntry) => {
      const entry: Record<string, unknown> = {
        result_code: csaEntry.result_code ?? null,
        result_detail: csaEntry.result_detail ?? null,
        call_duration: csaEntry.call_duration ?? null,
        call_setup_duration: csaEntry.call_setup_duration ?? null,
        is_multiparty: csaEntry.is_multiparty ?? null,
      };

      const eventBag = csaEntry.eventTimestampBag;
      if (eventBag && typeof eventBag === 'string') {
        try {
          const parsed = JSON.parse(eventBag) as Record<string, unknown>;
          entry.eventStart = parsed.eventStart ?? null;
          entry.events = parsed.events ?? [];
        } catch {
          entry.eventTimestampBag_raw = eventBag.slice(0, 500);
        }
      }

      return entry;
    }),
  };
  const scrubbedTimeline = JSON.parse(scrubLayer.scrubText(JSON.stringify(timelineData)));
  writePromises.push(writeFile(join(diagDir, 'timeline.toon'), encode(scrubbedTimeline), 'utf-8'));

  // 6. Participants (modelCall.clientEndpoints)
  const modelCall = (details.modelCall ?? {}) as Record<string, unknown>;
  const endpoints = (modelCall.clientEndpoints ?? []) as Array<Record<string, unknown>>;
  const participantsData = {
    totalEndpoints: endpoints.length,
    endpoints: endpoints.map((ep) => {
      const nodeId = (ep.nodeId as string) ?? '';
      const diagnostics = (ep.diagnostics ?? []) as Array<Record<string, unknown>>;
      const sessions = (ep.callSessions ?? []) as Array<Record<string, unknown>>;

      return {
        nodeId: nodeId.length > 20 ? nodeId.slice(0, 20) + '...' : nodeId,
        uiVersion: ep.uiVersion ?? {},
        diagnosticCount: diagnostics.length,
        diagnosticIssues: diagnostics
          .filter((d) => d.problemOccured === true)
          .slice(0, 10),
        callSessionCount: sessions.length,
        sessions: sessions.slice(0, 5).map((sess) => ({
          resultCode: sess.resultCode ?? null,
          resultDetail: sess.resultDetail ?? null,
          timestamps: sess.timestamps ?? [],
        })),
      };
    }),
  };
  const scrubbedParticipants = JSON.parse(scrubLayer.scrubText(JSON.stringify(participantsData)));
  writePromises.push(writeFile(join(diagDir, 'participants.toon'), encode(scrubbedParticipants), 'utf-8'));

  await Promise.all(writePromises);
  scrubLayer.save(diagDir);
  return 6; // Always creates 6 diagnostic files
}

// ============================================================================
// Metadata
// ============================================================================

export async function writeMetadata(
  callId: string,
  rawFiles: string[],
  stats: { callflowMessages: number; diagnosticFiles: number },
  outputDir: string
): Promise<void> {
  const metadata = {
    call_id: callId,
    fetched_at: new Date().toISOString(),
    raw_files: rawFiles,
    ai_friendly: {
      callflow: {
        index: 'callflow/index.csv',
        readme: 'callflow/README.txt',
        messages_dir: 'callflow/messages/',
        message_count: stats.callflowMessages,
        format: 'CSV index + TOON message files',
        usage: 'Read index.csv first, then look up specific messages by seq number in messages/NNNN.toon',
      },
      diagnostics: {
        summary: 'diagnostics/summary.toon',
        legs: 'diagnostics/legs.toon',
        qoe: 'diagnostics/qoe.toon',
        network: 'diagnostics/network.toon',
        timeline: 'diagnostics/timeline.toon',
        participants: 'diagnostics/participants.toon',
        format: 'TOON (Token-Oriented Object Notation) - 40% fewer tokens than JSON',
        usage: 'Read summary.toon first for overview, then drill into specific areas',
      },
    },
  };

  const scrubLayer = ScrubLayer.createDefault();
  const scrubbedMetadata = JSON.parse(scrubLayer.scrubText(JSON.stringify(metadata)));
  await writeFile(join(outputDir, 'metadata.toon'), encode(scrubbedMetadata), 'utf-8');
}
