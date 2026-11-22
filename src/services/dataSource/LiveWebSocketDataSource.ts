import { IDataSource, DataSourceCallbacks } from './IDataSource';
import { IngestibleMessage } from '../../types/telemetry';
import { PhuocTelemetryAdapter } from '../adapters/PhuocTelemetryAdapter';

export class LiveWebSocketDataSource implements IDataSource {
  public readonly mode = 'LIVE';
  private _isRunning = false;
  private ws: WebSocket | null = null;
  private callbacks: DataSourceCallbacks | null = null;
  private serverUrl: string;
  private reconnectAttempts = 0;
  private reconnectTimeout: number | null = null;
  private isIntentionallyClosed = false;

  constructor(serverUrl?: string) {
    // Default fallback to environment variable or PX4/FastAPI localhost:8000/ws/telemetry
    const envUrl = typeof import.meta !== 'undefined' && import.meta.env ? (import.meta.env.VITE_WS_TELEMETRY_URL as string) : undefined;
    this.serverUrl = serverUrl || envUrl || 'ws://localhost:8000/ws/telemetry';
  }

  public get isRunning(): boolean {
    return this._isRunning;
  }

  public get url(): string {
    return this.serverUrl;
  }

  public setUrl(url: string): void {
    const changed = this.serverUrl !== url;
    this.serverUrl = url;
    if (changed && this._isRunning && this.callbacks) {
      this.stop();
      this.start(this.callbacks);
    }
  }

  public start(callbacks: DataSourceCallbacks): void {
    this.callbacks = callbacks;
    this._isRunning = true;
    this.isIntentionallyClosed = false;
    this.reconnectAttempts = 0;
    this.connect();
  }

  public stop(): void {
    this._isRunning = false;
    this.isIntentionallyClosed = true;

    if (this.reconnectTimeout) {
      window.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore
      }
      this.ws = null;
    }

    this.callbacks?.onConnectionChange('DISCONNECTED', 'Đã ngắt kết nối WebSocket Live');
  }

  private connect(): void {
    if (!this._isRunning || this.isIntentionallyClosed) return;

    this.callbacks?.onConnectionChange('CONNECTING', `Đang kết nối máy chủ Telemetry WS: ${this.serverUrl}`);

    try {
      const socket = new WebSocket(this.serverUrl);
      this.ws = socket;

      this.ws.onopen = () => {
        if (this.ws !== socket || !this._isRunning) return;
        this.reconnectAttempts = 0;
        this.callbacks?.onConnectionChange('CONNECTED', `Đã kết nối Telemetry WS: ${this.serverUrl}`);
      };

      this.ws.onmessage = (event: MessageEvent) => {
        if (this.ws !== socket || !this._isRunning) return;
        try {
          const rawData = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          
          // Support arrays of messages or single messages
          const messageList = Array.isArray(rawData) ? rawData : [rawData];

          for (const item of messageList) {
            // Check if it's external simulator format (ASTM F3411 / Gazebo ENU)
            if (PhuocTelemetryAdapter.isPhuocTelemetry(item) || PhuocTelemetryAdapter.isPhuocEnvironment(item)) {
              const adapted = PhuocTelemetryAdapter.adapt(item);
              if (adapted) {
                if (Array.isArray(adapted)) {
                  adapted.forEach((m) => this.callbacks?.onMessage(m));
                } else {
                  this.callbacks?.onMessage(adapted);
                }
              } else {
                console.warn('[LiveWebSocket] Không thể chuyển đổi bản tin từ nguồn ngoài:', item);
              }
            } else {
              // Direct internal UTM format
              this.callbacks?.onMessage(item as IngestibleMessage);
            }
          }
        } catch (err) {
          console.warn('[LiveWebSocket] Bỏ qua gói tin không đúng định dạng JSON:', err);
        }
      };

      this.ws.onerror = () => {
        if (this.ws !== socket || !this._isRunning) return;
        if (!this.isIntentionallyClosed) {
          this.callbacks?.onConnectionChange('ERROR', `Lỗi kết nối tới ${this.serverUrl}`);
        }
      };

      this.ws.onclose = (event) => {
        if (this.ws !== socket || !this._isRunning) return;
        if (this.isIntentionallyClosed) return;

        this.callbacks?.onConnectionChange('RECONNECTING', `Mất kết nối (code ${event.code}). Sẽ thử kết nối lại...`);
        this.scheduleReconnect();
      };
    } catch (err) {
      this.callbacks?.onError(err instanceof Error ? err : new Error(String(err)));
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this._isRunning || this.isIntentionallyClosed) return;

    this.reconnectAttempts++;
    // Exponential backoff: 1.5s, 3s, 6s, max 10s
    const delay = Math.min(10000, 1500 * Math.pow(1.5, Math.min(this.reconnectAttempts, 5)));

    if (this.reconnectTimeout) {
      window.clearTimeout(this.reconnectTimeout);
    }

    this.reconnectTimeout = window.setTimeout(() => {
      if (this._isRunning && !this.isIntentionallyClosed) {
        this.connect();
      }
    }, delay);
  }
}
