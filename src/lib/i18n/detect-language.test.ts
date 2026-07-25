import { describe, expect, it } from "vitest";
import { detectLanguage, languageName } from "./detect-language";

const code = (s: string) => detectLanguage(s)?.code ?? null;

describe("detectLanguage — Latin-script languages", () => {
  it("detects English", () => {
    expect(
      code(
        "The government said on Tuesday that the new policy is expected to reduce costs for households, and that it will be reviewed in the autumn with a report to parliament.",
      ),
    ).toBe("en");
  });

  it("detects Spanish", () => {
    expect(
      code(
        "El gobierno anunció que la nueva política de vivienda entrará en vigor el próximo mes, y que los precios de los alquileres en las ciudades más grandes del país se revisarán con una comisión.",
      ),
    ).toBe("es");
  });

  it("detects French", () => {
    expect(
      code(
        "Le ministre a déclaré que les négociations qui ont eu lieu dans la capitale ont permis de trouver un accord sur les tarifs, et que le texte sera présenté au parlement dans une semaine.",
      ),
    ).toBe("fr");
  });

  it("detects German", () => {
    expect(
      code(
        "Die Regierung hat am Dienstag mitgeteilt, dass der neue Vorschlag nicht nur die Kosten senken soll, sondern auch mit dem Parlament abgestimmt wird und als Grundlage für weitere Reformen dient.",
      ),
    ).toBe("de");
  });

  it("detects Italian", () => {
    expect(
      code(
        "Il ministro ha dichiarato che le nuove misure per il mercato del lavoro sono state approvate con una maggioranza ampia, e che non si prevedono modifiche sostanziali per le imprese.",
      ),
    ).toBe("it");
  });

  it("detects Portuguese", () => {
    expect(
      code(
        "O governo anunciou que as novas medidas para os transportes públicos entram em vigor no próximo mês, com um investimento que não estava previsto para este ano em várias cidades do país.",
      ),
    ).toBe("pt");
  });

  it("detects Dutch", () => {
    expect(
      code(
        "De regering heeft dinsdag laten weten dat het nieuwe voorstel niet alleen de kosten moet verlagen, maar dat het ook met de Tweede Kamer wordt besproken voordat een besluit valt.",
      ),
    ).toBe("nl");
  });
});

describe("detectLanguage — non-Latin scripts", () => {
  it("detects Japanese via kana", () => {
    expect(code("政府は火曜日に、新しい政策が家庭の費用を削減すると発表しました。この計画は秋に見直される予定です。")).toBe("ja");
  });

  it("detects Chinese", () => {
    expect(code("政府周二表示，新政策预计将降低家庭成本，该计划将在秋季进行审查并向议会提交报告。")).toBe("zh");
  });

  it("detects Korean", () => {
    expect(code("정부는 화요일에 새로운 정책이 가계 비용을 줄일 것으로 예상된다고 밝혔으며 이 계획은 가을에 검토될 예정입니다.")).toBe("ko");
  });

  it("detects Russian", () => {
    expect(code("Правительство во вторник заявило, что новая политика, как ожидается, снизит расходы домохозяйств и будет пересмотрена осенью.")).toBe("ru");
  });

  it("separates Ukrainian from Russian by its distinctive letters", () => {
    expect(code("Уряд у вівторок заявив, що нова політика, як очікується, зменшить витрати домогосподарств, і її буде переглянуто восени цього року.")).toBe("uk");
  });

  it("detects Greek", () => {
    expect(code("Η κυβέρνηση ανακοίνωσε την Τρίτη ότι η νέα πολιτική αναμένεται να μειώσει το κόστος για τα νοικοκυριά.")).toBe("el");
  });

  it("detects Arabic", () => {
    expect(code("قالت الحكومة يوم الثلاثاء إن من المتوقع أن تؤدي السياسة الجديدة إلى خفض التكاليف على الأسر.")).toBe("ar");
  });
});

describe("detectLanguage — stays quiet when unsure", () => {
  it("returns null for text that is too short", () => {
    expect(detectLanguage("Hello there")).toBeNull();
    expect(detectLanguage("")).toBeNull();
    expect(detectLanguage(null)).toBeNull();
    expect(detectLanguage(undefined)).toBeNull();
  });

  it("returns null for content with no real language signal", () => {
    expect(detectLanguage("AAPL 182.30 +1.2% | MSFT 401.11 -0.4% | 2026-07-23 | 1234 5678 9012")).toBeNull();
  });

  it("is not thrown off by a few foreign characters in an English article", () => {
    expect(
      code(
        "The company said the product, known as こんにちは in Japan, is the result of a partnership that was announced in March and will be sold in more than twenty markets across Europe this year.",
      ),
    ).toBe("en");
  });

  it("ignores HTML markup when judging the text", () => {
    expect(
      code(
        "<div class='article'><p>The government said on Tuesday that the new policy is expected to reduce costs for households.</p><p>It will be reviewed in the autumn.</p></div>",
      ),
    ).toBe("en");
  });
});

describe("languageName", () => {
  it("names known codes", () => {
    expect(languageName("fr")).toBe("French");
    expect(languageName("ja")).toBe("Japanese");
  });
  it("falls back to the uppercased code for unknown ones", () => {
    expect(languageName("xx")).toBe("XX");
  });
});
