import { mapLogLevelToMessageType } from "@lisachandra/core/logger";
import { describe, expect, it } from "@rbxts/jest-globals";
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
