import { describe, it, expect } from "vitest";
import { pitchGreeting } from "./whatsapp-pitch";

describe("pitchGreeting", () => {
  it("shoban.india is Shobhan, Owner", () => {
    expect(pitchGreeting("shoban.india@hotelexcella.in")).toBe("I am Shobhan, Owner Hotel Excella, Vizag");
  });
  it("kilimshetty.kumar is Dileep, Owner", () => {
    expect(pitchGreeting("kilimshetty.kumar")).toBe("I am Dileep, Owner Hotel Excella, Vizag");
  });
  it("everyone else is Manager", () => {
    expect(pitchGreeting("reception@hotelexcella.in")).toBe("I am Manager, Hotel Excella, Vizag");
  });
});
