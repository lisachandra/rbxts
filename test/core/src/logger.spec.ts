import {
	fullLogOutputs,
	LogEventSFTOutputSink,
	logOutput,
	mapLogLevelToMessageType,
} from "@lisachandra/core/logger";
import { describe, expect, it, jest } from "@rbxts/jest-globals";
import { LogLevel } from "@rbxts/log";

describe("log level to message type mapping", () => {
	it("should map LogLevel to the correct Enum.MessageType", () => {
		expect.assertions(6);
		expect(mapLogLevelToMessageType(LogLevel.Debugging)).toBe(Enum.MessageType.MessageInfo);
		expect(mapLogLevelToMessageType(LogLevel.Verbose)).toBe(Enum.MessageType.MessageInfo);
		expect(mapLogLevelToMessageType(LogLevel.Information)).toBe(Enum.MessageType.MessageInfo);
		expect(mapLogLevelToMessageType(LogLevel.Warning)).toBe(Enum.MessageType.MessageWarning);
		expect(mapLogLevelToMessageType(LogLevel.Error)).toBe(Enum.MessageType.MessageError);
		expect(mapLogLevelToMessageType(LogLevel.Fatal)).toBe(Enum.MessageType.MessageError);
	});
});

describe("logEventSFTOutputSink fallback behavior", () => {
	function emit(level: LogLevel): void {
		const sink = new LogEventSFTOutputSink();
		sink.Emit({
			Level: level,
			name: "world",
			SourceContext: "test",
			Template: "hello {name}",
			Timestamp: "2024-01-01T00:00:00Z",
		});
	}

	it("should fall back to standard print/warn/error when in test mode", () => {
		expect.assertions(4);

		_G.__TEST__ = true;

		const mockPrint = jest.spyOn(jest.globalEnv, "print");
		mockPrint.mockImplementation(() => {});
		const mockWarn = jest.spyOn(jest.globalEnv, "warn");
		mockWarn.mockImplementation(() => {});

		emit(LogLevel.Information);

		expect(mockPrint).toHaveBeenCalled();

		emit(LogLevel.Warning);

		expect(mockWarn).toHaveBeenCalledTimes(1);

		// Error stays non-halting in fallback (legacy warn semantics).
		emit(LogLevel.Error);

		expect(mockWarn).toHaveBeenCalledTimes(2);

		// Fatal still halts.
		expect(() => emit(LogLevel.Fatal)).toThrow();
	});

	it("should preserve the ring buffer, flushing to fullLogOutputs past the cap", () => {
		expect.assertions(3);

		logOutput.clear();
		fullLogOutputs.clear();

		for (let index = 0; index < 200; index++) {
			emit(LogLevel.Information);
		}

		expect(fullLogOutputs).toHaveLength(1);
		expect(fullLogOutputs[0]).toHaveLength(129);
		expect(logOutput).toHaveLength(71);
	});
});
