import workspacesService from '@/services/workspacesService'
import { fixedPaneName } from '@/utils/paneNames'
import { Pane } from '@/store/panes'
import panesSettings from '@/store/panesSettings'
import { Preset } from '@/types/types'
import Vue from 'vue'
import Component from 'vue-class-component'

@Component({
  props: {
    paneId: {
      required: true,
      type: String
    }
  }
})
export default class PaneDialogMixin extends Vue {
  paneId: string

  get pane(): Pane {
    return this.$store.state.panes.panes[this.paneId]
  }

  // liquidation-terminal: pane names are fixed, so dialogs only read them
  get name() {
    return fixedPaneName(
      this.paneId,
      this.$store.state.panes.panes[this.paneId].type
    )
  }

  async resetPane(preset?: Preset) {
    await (this as any).close()

    let presetData = preset ? preset.data : null

    if (!presetData) {
      presetData = JSON.parse(
        JSON.stringify(
          panesSettings[this.$store.state.panes.panes[this.paneId].type].state
        )
      )
    }

    await this.$store.dispatch('panes/resetPane', {
      id: this.paneId,
      data: presetData
    })
  }

  async getPreset() {
    let storedState = await workspacesService.getState(this.paneId)

    if (!storedState) {
      await workspacesService.saveState(
        this.paneId,
        this.$store.state[this.paneId]
      )

      storedState = await workspacesService.getState(this.paneId)
    }

    return storedState
  }
}
