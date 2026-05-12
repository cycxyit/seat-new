<template>
  <div class="record-search-view">
    <div class="form-card center-content fadeInUp">
      <div class="card-icon">🔎</div>
      <h2>查询座位记录</h2>
      <p class="card-desc">请输入工号和姓名，系统将从 Google Sheets 总名单中匹配查询</p>

      <form @submit.prevent="submitSearch" class="search-form">
        <div class="field">
          <label>工号</label>
          <input v-model="userCode" type="text" placeholder="请输入工号" required autofocus />
        </div>
        <div class="field">
          <label>姓名</label>
          <input v-model="userName" type="text" placeholder="请输入姓名" required />
        </div>

        <button type="submit" class="primary btn-full" :disabled="searching || !userCode.trim() || !userName.trim()">
          <span v-if="searching" class="btn-loading"><span class="spinner-small"></span> 查询中...</span>
          <span v-else>开始查询</span>
        </button>
      </form>

      <div v-if="searchStatus === 'notfound'" class="alert info mt-16">
        查无数据 / 数据已被管理员删除
      </div>
      <div v-if="searchStatus === 'error'" class="alert error mt-16">
        {{ errorMessage || '查询失败，请稍后重试。' }}
      </div>

      <div v-if="searchStatus === 'found'" class="record-result mt-24">
        <div class="result-card">
          <div class="result-row">
            <span class="label">学生名字</span>
            <span class="value">{{ record.name }}</span>
          </div>
          <div class="result-row">
            <span class="label">Student ID</span>
            <span class="value">{{ record.student_id }}</span>
          </div>
          <div class="result-row">
            <span class="label">补几科</span>
            <span class="value">{{ record.subject_count }}</span>
          </div>
        </div>

        <div class="subject-table">
          <div class="table-header">
            <span>科目</span>
            <span>科室</span>
            <span>座位</span>
          </div>
          <div v-if="record.bookings.length === 0" class="empty-state">暂无科目记录</div>
          <div v-for="(booking, index) in record.bookings" :key="index" class="table-row">
            <span>{{ booking.subject || '—' }}</span>
            <span>{{ booking.theater_name || '—' }}</span>
            <span>{{ booking.seat || '—' }}</span>
          </div>
        </div>
      </div>

      <button v-if="searchStatus !== 'idle'" class="secondary btn-full mt-16" @click="resetSearch">
        重新查询
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { recordAPI } from '../services/api.js'

const userCode = ref('')
const userName = ref('')
const searching = ref(false)
const searchStatus = ref('idle') // idle | found | notfound | error
const errorMessage = ref('')
const record = ref({ name: '', student_id: '', subject_count: 0, bookings: [] })

async function submitSearch() {
  if (!userCode.value.trim() || !userName.value.trim()) return
  searching.value = true
  searchStatus.value = 'idle'
  errorMessage.value = ''
  record.value = { name: '', student_id: '', subject_count: 0, bookings: [] }
  try {
    const response = await recordAPI.searchRecord({ user_code: userCode.value.trim(), name: userName.value.trim() })
    if (response.data && response.data.success && response.data.data) {
      record.value = response.data.data
      searchStatus.value = 'found'
    } else {
      searchStatus.value = 'notfound'
    }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      searchStatus.value = 'notfound'
    } else {
      searchStatus.value = 'error'
      errorMessage.value = error.response?.data?.message || error.message || '查询失败，请稍后重试'
    }
  } finally {
    searching.value = false
  }
}

function resetSearch() {
  userCode.value = ''
  userName.value = ''
  record.value = { name: '', student_id: '', subject_count: 0, bookings: [] }
  searchStatus.value = 'idle'
  errorMessage.value = ''
}
</script>

<style scoped>
.record-search-view {
  display: flex;
  justify-content: center;
}

.form-card {
  width: min(100%, 720px);
  padding: 32px;
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}

.card-icon {
  font-size: 36px;
  margin-bottom: 18px;
}

.card-desc {
  margin-bottom: 24px;
  color: var(--text-secondary);
}

.search-form .field {
  margin-bottom: 18px;
}

.btn-full {
  width: 100%;
}

.mt-16 {
  margin-top: 16px;
}

.mt-24 {
  margin-top: 24px;
}

.result-card {
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 18px 20px;
  margin-bottom: 18px;
}

.result-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(226, 232, 240, 0.8);
}

.result-row:last-child { border-bottom: none; }

.label { color: var(--text-muted); font-weight: 600; }
.value { font-weight: 700; color: var(--text-primary); }

.subject-table {
  border: 1.5px solid var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.table-header,
.table-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
  align-items: center;
  padding: 14px 18px;
}

.table-header {
  background: var(--bg-subtle);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
}

.table-row {
  background: white;
  color: var(--text-primary);
}

.table-row:nth-child(odd) { background: #FBFBFB; }

.empty-state {
  padding: 18px;
  color: var(--text-muted);
  text-align: center;
}
</style>
