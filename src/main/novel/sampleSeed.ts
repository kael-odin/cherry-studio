/**
 * 示例中文小说工作区种子（Task #29：一键初始化）。
 *
 * 首次进入小说面板时，渲染器可以调用 `novel.init_workspace` 在
 * `feature.novel.workspace` 下生成一个开箱即用的 InkOS 项目：
 * 一份 inkos.json + 一部带三章正文的示例小说（灯塔守夜人）。
 * 生成之后工作区就完全交给 InkOS 引擎管理（宿主不碰工作目录）。
 */

/** 示例书 id 与标题。 */
export const SAMPLE_BOOK_ID = 'lighthouse-keeper'
export const SAMPLE_BOOK_TITLE = '灯塔守夜人'

export const SAMPLE_PROJECT_INKOS_JSON = {
  name: '我的小说工作区',
  version: '0.1.0',
  language: 'zh',
  llm: {
    provider: 'openai',
    service: 'custom',
    configSource: 'studio',
    baseUrl: '',
    model: '',
    apiFormat: 'chat',
    stream: true
  },
  notify: [],
  inputGovernanceMode: 'v2',
  daemon: {
    schedule: {
      radarCron: '0 */6 * * *',
      writeCron: '*/15 * * * *'
    },
    maxConcurrentBooks: 3
  }
}

export const SAMPLE_BOOK_CONFIG = {
  id: SAMPLE_BOOK_ID,
  title: SAMPLE_BOOK_TITLE,
  platform: 'other',
  genre: '都市',
  status: 'active',
  targetChapters: 100,
  chapterWordCount: 2000,
  language: 'zh',
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z'
}

export const SAMPLE_CHAPTER_INDEX = [
  {
    number: 1,
    title: '第一章 风暴',
    status: 'approved',
    wordCount: 2100,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    auditIssues: [],
    reviewNote: '开篇锚定主线，风暴中的灯塔意象完成。'
  },
  {
    number: 2,
    title: '第二章 灯',
    status: 'approved',
    wordCount: 1900,
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    auditIssues: [],
    reviewNote: '守夜人日常展开，人物关系推进。'
  },
  {
    number: 3,
    title: '第三章 潮汐',
    status: 'ready-for-review',
    wordCount: 2200,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
    auditIssues: ['时间线不一致：第三节提到退潮时间与开头描述矛盾'],
    reviewNote: ''
  }
]

export const SAMPLE_CHAPTERS: Array<{ filename: string; content: string }> = [
  {
    filename: '0001_风暴.md',
    content: `# 第一章 风暴

潮水退去，露出礁石下的铁锚。他站在灯塔顶端，望向海平面。

风暴是后半夜来的。灯塔守夜人周海生正擦拭透镜，就听见风从窗口灌进来，把桌上的航海日志吹得哗哗作响。他伸手按住纸页，望向窗外——远方的云层压得很低，几乎要贴着海面。

"来了。"他低声说。

灯塔建于民国十九年，砖石结构，八十年来从未被风暴撼动过。周海生在这座灯塔守了十二年，从见习守灯员做起，如今已是这座小岛上资历最老的人。岛上的渔民叫他"老周"，叫他守夜人，偶尔也有人叫他疯子——因为他不肯离开。

电闪划过天际时，他看见一艘小渔船在浪尖上挣扎。船尾的灯忽明忽暗，像随时会被吞没。

他抓起望远镜。船舷上站着一个女人，白色衣裙在风雨中猎猎作响，正拼命朝他挥手。

周海生怔住了。十二年里，他见过无数求助的船，可没有一次，像今天这样让他心悸。

他没有犹豫，转身冲下螺旋楼梯，拉响了救生铃。`
  },
  {
    filename: '0002_灯.md',
    content: `# 第二章 灯

清晨，风暴过去，海面恢复平静。

那艘小渔船搁浅在灯塔南侧的沙滩上。周海生沿着礁石走过去，看见船身裂开一道口子，却不见人影。他找遍了整个海滩，只捡到一枚被海水泡得发白的银质怀表。

怀表的背面刻着一行小字：苏晚晴，1998年6月。

他忽然想起昨天那个白裙女人。是她的表吗？她把表留在这里，是求救，还是告别？

灯塔的日常工作照旧：擦透镜，记日志，检查油料储备。周海生把怀表放在控制台上，每次抬头都能看见。他记得母亲说过，海上的东西，捡到了就要还。

可向谁还？

午后，一艘补给船靠岸。船工老陈带来一封信，说是城里一个叫"苏晚晴"的人寄来的，收件人写着"灯塔守夜人"。信很薄，里面只有一张照片——照片里是一座亮着灯的灯塔，角度正是从海上看来的模样。

照片背面同样有一行小字：你记得我吗？

周海生捏着照片，站在灯塔顶端，很久没有动。`
  },
  {
    filename: '0003_潮汐.md',
    content: `# 第三章 潮汐

退潮的时候，周海生下了海。

那片礁石区只在退潮时露出水面，他记得小时候听爷爷说，礁石下面埋着一条沉船，是战乱年间沉下去的。他一直以为那是传说，直到昨天，他在望远镜里看见礁石间闪过一道金属的光。

他穿着防水靴，在齐膝的海水里摸索。潮水正在退，海浪一波一波地拍打着他的小腿。

就在他准备放弃时，脚下一滑，他的手按在一块铁板上。那铁板锈迹斑斑，边缘光滑——不是船体，是舱门。

他用力撬开。舱门下面是一个不大的空间，积着淤泥和海水。手电筒的光照进去，他看见一口铁箱。箱子上没有锁，只贴着一张发黄的纸条，上面写着：找到我的人，请把它交给苏晚晴。

周海生怔住了。

苏晚晴。又是苏晚晴。

他抱着铁箱回到灯塔，用清水洗净。箱子打开的那一瞬间，他明白了为什么有人要用沉船藏住它——里面整整齐齐码着一叠账本，封皮上印着"临海市港务局 1997"。

1997年。港口。账本。

他想起岛上流传多年的说法：九十年代末，临海港吞掉了一批进口钢材，去向不明。所有知情的人，要么调走，要么失踪。

他把账本放回箱子，锁好，塞进床底。然后他走到控制台前，拿起那枚怀表，看了很久。

海面平静，灯塔的灯准时亮了。`
  }
]
