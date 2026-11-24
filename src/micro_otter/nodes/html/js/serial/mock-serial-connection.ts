import { SerialConnectionBase } from './serial-connection-base.js';

type SerialData = string | Uint8Array;
type MockLogger = ((prefix: string, message: string, data?: unknown) => void) | null;

interface MockSerialConnectionOptions {
    logger?: MockLogger;
    connectionDelay?: number;
    disconnectionDelay?: number;
    simulateErrors?: boolean;
}

interface MockConnectOptions {
    baudRate?: number;
    portName?: string;
}

interface MockConnectionInfo {
    type: 'mock';
    port: string;
    baudRate: number;
}

export class MockSerialConnection extends SerialConnectionBase {
    private _connectionDelay: number;
    private _disconnectionDelay: number;
    private _simulateErrors: boolean;
    private _mockPort: string | null;
    private _sentData: SerialData[];

    constructor(options: MockSerialConnectionOptions = {}) {
        super(options);

        this._connectionDelay = options.connectionDelay ?? 10;
        this._disconnectionDelay = options.disconnectionDelay ?? 10;
        this._simulateErrors = options.simulateErrors ?? false;
        this._mockPort = null;
        this._sentData = [];
    }

    async connect(options: MockConnectOptions = {}): Promise<void> {
        this._setState('connecting');
        this._emitConnecting(options);

        this._log('Connecting with options:', options);

        await new Promise<void>((resolve) => {
            const timer: ReturnType<typeof setTimeout> = setTimeout(resolve, this._connectionDelay);
            void timer;
        });

        if (this._simulateErrors && Math.random() < 0.2) {
            const error = new Error('Mock connection failed (simulated error)');
            this._emitError(error, 'connect');
            throw error;
        }

        this._mockPort = options.portName || 'mock-port';
        const connectionInfo: MockConnectionInfo = {
            type: 'mock',
            port: this._mockPort,
            baudRate: options.baudRate || 115200,
        };
        this._connectionInfo = connectionInfo;

        this._setState('connected');
        this._emitConnected(this._connectionInfo);

        this._log('Connected to mock port:', this._mockPort);
    }

    async disconnect(): Promise<void> {
        this._setState('disconnecting');
        this._emitDisconnecting();

        this._log('Disconnecting from mock port:', this._mockPort);

        await new Promise<void>((resolve) => {
            const timer: ReturnType<typeof setTimeout> = setTimeout(
                resolve,
                this._disconnectionDelay
            );
            void timer;
        });

        if (this._simulateErrors && Math.random() < 0.1) {
            const error = new Error('Mock disconnection failed (simulated error)');
            this._emitError(error, 'disconnect');
            throw error;
        }

        this._mockPort = null;
        this._connectionInfo = null;

        this._setState('disconnected');
        this._emitDisconnected('user');

        this._log('Disconnected');
    }

    async send(data: SerialData): Promise<void> {
        if (!this.isConnected()) {
            throw new Error('Cannot send: not connected');
        }

        if (this._simulateErrors && Math.random() < 0.1) {
            const error = new Error('Mock send failed (simulated error)');
            this._emitError(error, 'send');
            throw error;
        }

        this._sentData.push(data);
        this._log('Sent data:', data);
    }

    simulateReceive(data: SerialData): void {
        if (!this.isConnected()) {
            this._log('Warning: simulateReceive called while not connected');
            return;
        }

        this._log('Simulating received data:', data);
        this._emitDataReceived(data);
    }

    getSentData(): SerialData[] {
        return [...this._sentData];
    }

    clearSentData(): void {
        this._sentData = [];
        this._log('Cleared sent data log');
    }

    simulateError(context: string, message = 'Simulated error'): void {
        const error = new Error(message);
        this._emitError(error, context);
    }
}
