import store from '@/store'
import { slugify } from '@/utils/helpers'
import workspacesService from './workspacesService'

class GifsService {
  cache: { [keyword: string]: string[] } = {}
  promisesOfGifs: { [keyword: string]: Promise<string[]> } = {}

  constructor() {
    setTimeout(this.cleanExpiredGifs.bind(this), 60000 + Math.random() * 60000)
  }

  async cleanExpiredGifs() {
    const keywords = await workspacesService.getGifsKeywords()
    const now = Date.now()

    for (const keyword of keywords) {
      if (this.cache[keyword]) {
        continue
      }

      const slug = slugify(keyword)

      const storedGifs = await workspacesService.getGifs(slug)

      if (
        !storedGifs ||
        now - storedGifs.timestamp >= 1000 * 60 * 60 * 24 * 7
      ) {
        this.deleteGifs(keyword)
      }
    }
  }

  forgetGifs(keyword) {
    if (this.cache[keyword]) {
      store.dispatch('app/showNotice', {
        title:
          'Forgeting ' +
          this.cache[keyword].length +
          ' gifs about "' +
          keyword +
          '"',
        type: 'info'
      })

      delete this.cache[keyword]
    }
  }

  async deleteGifs(keyword) {
    const slug = slugify(keyword)
    await workspacesService.deleteGifs(slug)

    store.dispatch('app/showNotice', {
      title: 'Removed gifs about "' + keyword + '"',
      type: 'info'
    })
  }

  async getGifs(keyword, showNotice?: boolean) {
    if (!keyword) {
      return
    }

    if (this.cache[keyword]) {
      return this.cache[keyword]
    }

    if (this.promisesOfGifs[keyword]) {
      return this.promisesOfGifs[keyword]
    }

    const slug = slugify(keyword)

    this.promisesOfGifs[keyword] = workspacesService
      .getGifs(slug)
      .then(storedGifs => {
        delete this.promisesOfGifs[keyword]

        if (
          storedGifs &&
          Date.now() - storedGifs.timestamp < 1000 * 60 * 60 * 24 * 7
        ) {
          this.cache[keyword] = storedGifs.data

          return storedGifs.data
        } else {
          return this.fetchGifByKeyword(keyword, showNotice)
        }
      })

    return this.promisesOfGifs[keyword]
  }

  // liquidation-terminal: Giphy lookups removed (no requests to api.giphy.com)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async fetchGifByKeyword(keyword: string, showNotice?: boolean) {
    delete this.promisesOfGifs[keyword]
    return undefined
  }
}

export default new GifsService()
