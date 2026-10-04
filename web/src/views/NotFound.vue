<script setup lang="ts">
import { $gettext } from '@/lib/gettext'
</script>

<template>
  <AResult status="404" :title="$gettext('Page not found')" :sub-title="$gettext('The page you are looking for does not exist.')">
    <template #extra>
      <RouterLink to="/plugins">
        <AButton type="primary">
          {{ $gettext('Back to my plugins') }}
        </AButton>
      </RouterLink>
    </template>
  </AResult>
</template>
