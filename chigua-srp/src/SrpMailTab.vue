<template>
  <SrpTab>
    <template #header-left>
      <VxeButton
        status="primary"
        :loading="props.loading"
        :disabled="isAwaitingReview()"
        @click="sendMails(rows)"
        >{{ isAwaitingReview() ? "有 KM 待审核" : "发送至游戏内" }}</VxeButton
      >
    </template>

    <template #body>
      <VxeTable
        ref="table"
        border
        stripe
        size="medium"
        height="auto"
        auto-resize
        empty-text="无 KM 数据，请先拉取"
        :show-header="rows.length > 0"
        :loading="props.loading"
        :row-config="{ isHover: true, keyField: 'key' }"
        :edit-config="{ trigger: 'click', mode: 'cell', showIcon: false }"
        :data="rows"
      >
        <VxeColumn
          field="payee.name"
          title="收款人"
          width="250"
          show-overflow="tooltip"
        ></VxeColumn>

        <VxeColumn field="kind" title="类型" width="auto"></VxeColumn>

        <VxeColumn
          field="mIsks"
          title="金额"
          width="auto"
          align="right"
          header-align="left"
          :formatter="
            ({ cellValue }) => {
              if (cellValue === undefined) return '';
              const sum = (cellValue as number[]).reduce(
                (sum, mIsk) => sum + mIsk,
                0,
              );
              return `${sum}m`;
            }
          "
        ></VxeColumn>

        <VxeColumn
          field="notes"
          title="备注"
          :edit-render="{
            name: 'VxeInput',
            props: {
              clearable: true,
              trim: true,
              disabled: isAwaitingReview(),
              placeholder: isAwaitingReview() ? '有 KM 待审核' : '请输入',
            },
          }"
          :title-suffix="{ icon: 'vxe-icon-edit' }"
        ></VxeColumn>
      </VxeTable>
    </template>
  </SrpTab>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { VxeButton } from "vxe-pc-ui";
import { VxeColumn, VxeTable } from "vxe-table";

import SrpTab from "./SrpTab.vue";
import { ErrorMessage } from "./error";
import { sendMail, type Killmail } from "./esi";
import { getShipNames } from "./sde";
import { type SrpData, type SrpPayee } from "./srp";
import {
  SrpKind,
  useSrpOutcomeStore,
  type SrpOutcomeEntry,
  type SrpOutcomeKey,
} from "./stores/srpOutcomeStore";

const props = defineProps<{
  loading: boolean;
  srpData: SrpData;
}>();

const rows = ref<Row[]>([]);
type Row = { key: SrpOutcomeKey } & SrpOutcomeEntry;
type ApprovedRow = Row & { kind: SrpKind.Approve };
type RejectedRow = Row & { kind: SrpKind.Reject };

const srpOutcome = useSrpOutcomeStore();
watch(
  () => srpOutcome.srpOutcome,
  () => {
    console.log("triggered");
    rows.value = Array.from(
      srpOutcome.srpOutcome
        .entries()
        .map(([key, value]) => ({ key, ...value })),
    );
  },
  {
    deep: true,
    // This tab is lazily mounted. We need to trigger this watcher upon
    // mounting.
    immediate: true,
  },
);

function isAwaitingReview(): boolean {
  return (
    rows.value.find((row) => row.kind === SrpKind.AwaitingReview) !== undefined
  );
}

async function sendMails(rows: Row[]) {
  const composer = new MailComposer();
  rows.forEach((row) => composer.with(row));
  const mails = composer.finish();

  for (const [idx, mail] of mails.entries()) {
    let subject = "以上已补损";
    if (mails.length > 1) subject = `${subject} (${idx + 1}/${mails.length})`;
    await sendMail(subject, mail);
  }
}

class MailComposer {
  private static readonly MAIL_START = '<font size="14" color="#bfffffff">';
  private static readonly MAIL_START_LINK =
    // EVE always inserts this default font.
    '<font size="14" color="#bfffffff"></font><font size="14" color="#ffd98d00">';
  private static readonly MAIL_END = "</font>";
  // ESI's doc states the limit is 10,000, but it's actually 8,000 in-game.
  private static readonly MAIL_CHAR_LIMIT = 8_000;

  private mails: string[] = [""];
  private _buffer: string = MailComposer.MAIL_START;
  private _state: "text" | "link" | "finished" = "text";

  private get buffer(): typeof this._buffer {
    return this._buffer;
  }
  private set buffer(buffer: typeof this._buffer) {
    this.throwIfFinished();
    this._buffer = buffer;
  }

  private get state(): typeof this._state {
    return this._state;
  }
  private set state(state: typeof this._state) {
    this.throwIfFinished();
    this._state = state;
  }

  public with(row: Row): MailComposer {
    if (row.kind === SrpKind.AwaitingReview)
      throw new Error(ErrorMessage.AwaitingReview);
    if (row.kind === SrpKind.Approve) return this.approve(row);
    return this.reject(row);
  }

  public finish(): string[] {
    this.buffer += MailComposer.MAIL_END;
    this.flushBuffer();
    this.state = "finished";
    return this.mails;
  }

  private approve(row: ApprovedRow): MailComposer {
    this.payeeLink(row.payee);
    row.killmails.forEach((killmail) => this.killMailLink(killmail));

    return this.priceSum(row).note(row).emptyLine().flushBuffer();
  }

  private reject(row: RejectedRow): MailComposer {
    return this.payeeLink(row.payee)
      .killMailLink(row.killmail)
      .text("拒绝补损")
      .note(row)
      .emptyLine()
      .flushBuffer();
  }

  private priceSum(row: ApprovedRow): MailComposer {
    const sum = row.mIsks.reduce((sum, mIsk) => sum + mIsk, 0);
    this.newline();
    if (row.mIsks.length === 1) return this.text(`${sum}m`);
    return this.text(`${row.mIsks.join("+")}=${sum}m`);
  }

  private note(row: Row): MailComposer {
    if (row.note) return this.text(` (${row.note})`);
    return this;
  }

  private text(text: string): MailComposer {
    this.changeFontToNormal();
    this.buffer += text;
    return this;
  }

  private newline(): MailComposer {
    this.buffer += "<br>";
    return this;
  }

  private emptyLine(): MailComposer {
    if (this.buffer.endsWith("<br><br>")) return this;
    if (this.buffer.endsWith("<br>")) return this.newline();
    return this.newline().newline();
  }

  private payeeLink(payee: SrpPayee): MailComposer {
    this.addLinkText(`showinfo:1377//${payee.id}`, payee.name, false);
    return this;
  }

  private killMailLink(killmail: Killmail): MailComposer {
    const shipNames = getShipNames(killmail.killmail.victim.ship_type_id);
    const shipName = shipNames?.zh ?? shipNames?.en ?? "";
    this.addLinkText(
      `killReport:${killmail.pointer.id}:${killmail.pointer.hash}`,
      `击杀：${shipName}`,
    );
    return this;
  }

  private addLinkText(
    link: string,
    text: string,
    prependSpace: boolean = true,
  ): void {
    this.changeFontToLink();
    this.buffer += `${prependSpace ? " " : ""}<a href="${link}">${text}</a> `;
  }

  private changeFontToLink(): void {
    if (this.state === "text") {
      this.buffer += '</font><font size="14" color="#ffd98d00">';
      this.state = "link";
    }
  }

  private changeFontToNormal(): void {
    if (this.state === "link") {
      this.buffer += '</font><font size="14" color="#bfffffff">';
      this.state = "text";
    }
  }

  private throwIfFinished(): void {
    if (this.state === "finished")
      throw new Error(ErrorMessage.MailComposerFinished);
  }

  private flushBuffer(): MailComposer {
    if (!this.isCharacterLimitExceeded()) {
      this.mails[this.mails.length - 1]! += this.buffer;
      this.buffer = "";
      return this;
    }

    this.mails[this.mails.length - 1]! += MailComposer.MAIL_END;
    const mailStart =
      this.state === "link"
        ? MailComposer.MAIL_START_LINK
        : MailComposer.MAIL_START;
    this.mails.push(mailStart + this.buffer);
    this.buffer = "";
    return this;
  }

  private isCharacterLimitExceeded(): boolean {
    return (
      this.mails.at(-1)!.length + this.buffer.length >
      MailComposer.MAIL_CHAR_LIMIT
    );
  }
}
</script>
