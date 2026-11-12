import { describe, it, expect } from "vitest";
import { pitchGreeting } from "./whatsapp-pitch";

describe("pitchGreeting", () => {
  it("email containing shobhan is Shobhan, Owner", () => {
    expect(pitchGreeting("shobhan.india@gmail.com")).toBe("I am Shobhan, Owner Hotel Excella, Vizag");
  });
  it("email containing shoban is Shobhan, Owner", () => {
    expect(pitchGreeting("shoban.india@hotelexcella.in")).toBe("I am Shobhan, Owner Hotel Excella, Vizag");
  });
  it("email containing killamsetti.kumar is Dileep, Owner", () => {
    expect(pitchGreeting("killamsetti.kumar@gmail.com")).toBe("I am Dileep, Owner Hotel Excella, Vizag");
  });
  it("everyone else is Manager", () => {
    expect(pitchGreeting("reception@hotelexcella.in")).toBe("I am Manager, Hotel Excella, Vizag");
  });
});
