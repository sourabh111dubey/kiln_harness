export interface LspDiagnosticLike {
  message: string;
  severity?: number;
  source?: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface LspSymbolLike {
  name: string;
  kind?: number;
  location: {
    uri: string;
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  };
}

export interface LspManagerLike {
  diagnosticsFor(path: string): Promise<LspDiagnosticLike[]>;
  symbolsFor(path: string): Promise<LspSymbolLike[]>;
}
