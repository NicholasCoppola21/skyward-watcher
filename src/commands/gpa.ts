import {
  type ChatInputCommandInteraction,
  type CacheType,
  SlashCommandBuilder,
} from "discord.js";
import SlashCommand, { type Builder } from "../SlashCommand";
import Login from "./login";
import {
  SkywardAccountManager,
  SkywardError,
  type ReportCard,
  calcSemesterGPA as calcCCISDSemesterGPA,
  avgArray,
} from "ccisd-skyward";

export default class GPACommand extends SlashCommand {
  public override opts: Builder = new SlashCommandBuilder()
    .setName("gpa")
    .setDescription("Calculates your GPA! Make sure to run /login first!")
    .addNumberOption((s) =>
      s
        .setName("grade")
        .setDescription("What grade you're currently in.")
        .setChoices(
          {
            name: "12th grade",
            value: 12,
          },
          {
            name: "11th grade",
            value: 11,
          },
          {
            name: "10th grade",
            value: 10,
          },
          {
            name: "9th grade",
            value: 9,
          },
        )
        .setRequired(true),
    )
    .addStringOption((s) =>
      s
        .setName("type")
        .setDescription("The type of GPA average you want to calculate")
        .setChoices(
          {
            name: "CCISD",
            value: "CCISD",
          },
          {
            name: "Unweighted (Unweighted) GPA",
            value: "UNWEIGHTED",
          },
          {
            name: "All",
            value: "ALL",
          },
        )
        .setRequired(true),
    )
    .addBooleanOption((b) =>
      b
        .setName("show")
        .setDescription(
          "If in a server and true, shows your grades publically.",
        ),
    );

  public override async run(
    i: ChatInputCommandInteraction<CacheType>,
  ): Promise<void> {
    await i.deferReply({
      ephemeral: i.inCachedGuild()
        ? !i.options.getBoolean("show") ?? true
        : false,
    });
    const session = await Login.getSession(i.user.id);

    if (!session)
      return void i.editReply({ content: "Please run /login first!" });

    let allReportCards = await session.fetchReportCards();

    if (SkywardError.LOGIN_EXPIRED === allReportCards) {
      const newSession = await Login.getSession(i.user.id, true);

      if (!newSession)
        return void i.editReply({
          content: "Session expired! Please run /login again!",
        });

      allReportCards = await newSession.fetchReportCards();
    }

    if (SkywardAccountManager.isError(allReportCards))
      return void i.editReply({
        content: `Something went wrong.. Please try again later or ping the developer with the erorr: \`${allReportCards}\`.`,
      });

    const grade = i.options.getNumber("grade", true);
    if (grade < 9 || grade > 12)
      return void i.editReply({ content: "Grade must be between 9-12" });
    const type: string = i.options.getString("type", false) ?? "CCISD";

    // the most recent report card is the most updated for this person, trimming out progress and staar EOCs

    let validReportCards = allReportCards
      .filter(
        (n) =>
          !n.name.toLowerCase().includes("progress") &&
          !n.name.toLowerCase().includes("staar"),
      )
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    const reportCardNames = [validReportCards[0]];

    validReportCards = validReportCards.slice(1);

    // until we hit 9th grade, the next important report card is next Q4

    for (let i = grade; i > 9; i--) {
      const index = validReportCards.findIndex((s) => s.name.includes("Q4"));
      reportCardNames.push(validReportCards[index]);
      validReportCards = validReportCards.slice(index + 1);
    }

    const reportCards = await Promise.all(
      reportCardNames.map((a) => session.fetchReportCard(a.name)),
    );

    if (reportCards.some((r) => SkywardAccountManager.isError(r)))
      return void i.editReply({
        content: `Failed to fetch report cards with error: ${reportCards.find(
          (r) => SkywardAccountManager.isError(r),
        )}. Please try again later or ping the dev with that error.`,
      });

    let text = "";
    const calc = (type: string) => {
      const gpas: number[] = [];
      for (const reportCard of reportCards as ReportCard[]) {
        text += `__**${type} ${reportCard.name}**__\n`;
        const s1 =
          type === "CCISD"
            ? calcCCISDSemesterGPA(reportCard, "SM1")
            : GPACommand.calcUnweightedGPA(reportCard, "SM1");
        const s2 =
          type === "CCISD"
            ? calcCCISDSemesterGPA(reportCard, "SM2")
            : GPACommand.calcUnweightedGPA(reportCard, "SM2");

        const semGPAs = [];

        if (s1) {
          semGPAs.push(s1);
          gpas.push(s1);

          text += `Semester 1 GPA: ${GPACommand.nf(s1)}\n`;
        }

        if (s2) {
          semGPAs.push(s2);
          gpas.push(s2);

          text += `Semester 2 GPA: ${GPACommand.nf(s2)}\n`;
        }

        text += `GPA for Report Card: ${GPACommand.nf(avgArray(semGPAs))}\n`;
      }
      text += `\nOverall GPA: ${GPACommand.nf(avgArray(gpas))}/${
        type === "CCISD" ? 6 : 4
      }`;
    };

    switch (type) {
      case "CCISD":
        calc("CCISD");
        break;
      case "UNWEIGHTED":
        calc("UNWEIGHTED");
        break;
      case "ALL":
        calc("CCISD");
        text += "\n\n";
        calc("SMIPLE");
    }

    return void i.editReply({
      content: text,
    });
  }

  private static calcUnweightedGPA(
    reportCard: ReportCard,
    semester: "SM1" | "SM2",
  ): null | number {
    const gpas = [];

    for (const c of reportCard.classes) {
      const term = c.terms.find((a) => a.term === semester);
      if (!term) return null;
      const grade = Number(term.grade);

      if (grade >= 90) gpas.push(4.0);
      else if (grade >= 80) gpas.push(3.0);
      else if (grade >= 70) gpas.push(2.0);
      else if (grade >= 60) gpas.push(1.0);
      else gpas.push(0.0);
    }

    return avgArray(gpas);
  }

  private static nf(n: number): number {
    return Math.round(n * 1000) / 1000;
  }
}
