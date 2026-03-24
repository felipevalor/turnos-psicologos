import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Kapso SDK — must be before imports that use it
const mockSendText = vi.fn().mockResolvedValue(undefined);
vi.mock('@kapso/whatsapp-cloud-api', () => ({
  WhatsAppClient: vi.fn().mockImplementation(function () {
    return { messages: { sendText: mockSendText } };
  }),
}));

import {
  sendBookingConfirmation,
  sendBookingCancellation,
  sendBookingReschedule,
} from '../notifications';
import type { Env } from '../../types';

function makeEnv(overrides?: Partial<Env>): Env {
  return {
    DB: {} as D1Database,
    JWT_SECRET: 'test',
    KAPSO_API_KEY: 'test-key',
    KAPSO_PHONE_NUMBER_ID: '123456',
    ...overrides,
  };
}

const booking = {
  patientName: 'Ana García',
  patientPhone: '+5491112345678',
  date: '2026-03-25',
  startTime: '10:00',
  psychologistName: 'Dr. López',
  psychologistPhone: '+5491187654321',
};

describe('sendBookingConfirmation', () => {
  beforeEach(() => mockSendText.mockClear());

  it('sends nothing when KAPSO_API_KEY is missing', async () => {
    await sendBookingConfirmation(makeEnv({ KAPSO_API_KEY: undefined }), booking);
    expect(mockSendText).not.toHaveBeenCalled();
  });

  it('sends nothing when KAPSO_PHONE_NUMBER_ID is missing', async () => {
    await sendBookingConfirmation(makeEnv({ KAPSO_PHONE_NUMBER_ID: undefined }), booking);
    expect(mockSendText).not.toHaveBeenCalled();
  });

  it('sends patient confirmation with correct message', async () => {
    await sendBookingConfirmation(makeEnv(), booking);
    expect(mockSendText).toHaveBeenCalledWith({
      phoneNumberId: '123456',
      to: '5491112345678',
      body: '¡Hola Ana García! Tu sesión fue confirmada para el 2026-03-25 a las 10:00 hs. ¡Te esperamos!',
    });
  });

  it('sends psychologist confirmation with + stripped from phone', async () => {
    await sendBookingConfirmation(makeEnv(), booking);
    expect(mockSendText).toHaveBeenCalledWith({
      phoneNumberId: '123456',
      to: '5491187654321',
      body: 'Nueva sesión agendada: Ana García el 2026-03-25 a las 10:00 hs. Tel: +5491112345678',
    });
  });

  it('skips psychologist message when psychologistPhone is null', async () => {
    await sendBookingConfirmation(makeEnv(), { ...booking, psychologistPhone: null });
    expect(mockSendText).toHaveBeenCalledTimes(1);
    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({ to: '5491112345678' }),
    );
  });
});

describe('sendBookingCancellation', () => {
  beforeEach(() => mockSendText.mockClear());

  it('sends patient cancellation message', async () => {
    await sendBookingCancellation(makeEnv(), booking, 'patient');
    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '5491112345678',
        body: 'Hola Ana García, tu sesión del 2026-03-25 a las 10:00 hs fue cancelada.',
      }),
    );
  });

  it('sends patient-initiated psychologist message', async () => {
    await sendBookingCancellation(makeEnv(), booking, 'patient');
    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '5491187654321',
        body: 'Ana García canceló su sesión del 2026-03-25 a las 10:00 hs.',
      }),
    );
  });

  it('sends admin-initiated psychologist message', async () => {
    await sendBookingCancellation(makeEnv(), booking, 'admin');
    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '5491187654321',
        body: 'Cancelaste la sesión de Ana García del 2026-03-25 a las 10:00 hs.',
      }),
    );
  });
});

describe('sendBookingReschedule', () => {
  beforeEach(() => mockSendText.mockClear());

  it('sends patient reschedule message', async () => {
    await sendBookingReschedule(makeEnv(), booking, 'patient');
    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '5491112345678',
        body: '¡Hola Ana García! Tu sesión fue reprogramada al 2026-03-25 a las 10:00 hs.',
      }),
    );
  });

  it('sends patient-initiated psychologist message', async () => {
    await sendBookingReschedule(makeEnv(), booking, 'patient');
    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Ana García reprogramó su sesión al 2026-03-25 a las 10:00 hs.',
      }),
    );
  });

  it('sends admin-initiated psychologist message', async () => {
    await sendBookingReschedule(makeEnv(), booking, 'admin');
    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Reprogramaste la sesión de Ana García al 2026-03-25 a las 10:00 hs.',
      }),
    );
  });
});
